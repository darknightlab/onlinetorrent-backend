// typescript
import fs from "fs";
import YAML from "yaml";
import express from "express";
import parseTorrent from "parse-torrent";
import { toMagnetURI, toTorrentFile } from "parse-torrent";
import magnet from "magnet-uri";
import { qBittorrentClient, TorrentAddParameters, TorrentInfoParameters } from "@robertklep/qbittorrent";
import asyncHandler from "express-async-handler";
import cors from "cors";
import { createProxyMiddleware, Filter, Options, RequestHandler } from "http-proxy-middleware";
import { SocksProxyAgent } from "socks-proxy-agent";

const configPath = "./config/config.yaml";
var config = YAML.parse(fs.readFileSync(configPath, "utf8"));
let proxyAgent: SocksProxyAgent | undefined;
if (config.proxy) {
    proxyAgent = new SocksProxyAgent(config.proxy);
} else {
    proxyAgent = undefined;
}

function sleep(ms: number) {
    return new Promise((resolve, reject) => setTimeout(resolve, ms, undefined));
}

async function processPromises<T>(promises: Promise<T>[]): Promise<(T | Error)[]> {
    let results = await Promise.allSettled(promises);
    return results.map((result) => (result.status === "fulfilled" ? result.value : result.reason instanceof Error ? result.reason : new Error(String(result.reason))));
}

async function processPromisesDict<T>(promises: Promise<T>[]): Promise<{ [key: string]: Error | T }> {
    let resdict: { [key: string]: T | Error } = {};
    let results = await processPromises(promises);
    for (let i = 0; i < results.length; i++) {
        resdict[qbserverlist.qbservers[i].name] = results[i];
    }
    return resdict;
}

class qbServer {
    name: string;
    qbURL: string;
    webseedURL: string;
    username: string;
    password: string;
    category: string;
    ratioLimit: number | undefined;
    seedingTimeLimit: number | undefined; // minutes
    sequentialDownload: boolean;
    firstLastPiecePrio: boolean;
    online: boolean = false;
    qb: qBittorrentClient;
    checkOnlineTimer: NodeJS.Timeout;
    checkFinishedTimer: NodeJS.Timeout;

    constructor(serverObj: any) {
        this.name = serverObj.name;
        this.qbURL = serverObj.qbURL;
        this.webseedURL = serverObj.webseedURL;
        this.username = serverObj.username;
        this.password = serverObj.password;
        this.category = serverObj.category || "projectk";
        this.ratioLimit = serverObj.ratioLimit || undefined;
        this.seedingTimeLimit = serverObj.seedingTimeLimit || undefined;
        this.sequentialDownload = serverObj.sequentialDownload || true;
        this.firstLastPiecePrio = serverObj.firstLastPiecePrio || true;
        this.qb = new qBittorrentClient(this.qbURL, this.username, this.password);
        this.online = true;

        this.checkOnlineTimer = setInterval(async () => {
            await Promise.race([this.checkOnlineAndReconnect(), sleep(60 * 1000)]);
        }, 5 * 60 * 1000);

        this.checkFinishedTimer = setInterval(async () => {
            try {
                let result = await Promise.race([this.torrentsInfo(), sleep(60 * 1000)]);
                if (result) {
                    let delres = [];
                    for (let tinfo of result) {
                        if (tinfo.state == "pausedUP" && tinfo.eta == 8640000) {
                            delres.push(this.qb.torrents.delete(tinfo.hash, true));
                        }
                    }
                    let resdict = await processPromisesDict(delres);
                    // console.log(resdict);
                }
            } catch (e) {
                console.error(e);
            }
        }, 5 * 60 * 1000);
    }

    async checkOnline() {
        try {
            let res = await this.qb.app.version();
            if (res) {
                this.online = true;
                return true;
            }
        } catch (e) {}
        this.online = false;
        return false;
    }

    async checkOnlineAndReconnect() {
        await this.checkOnline();

        if (!this.online) {
            console.log(`server ${this.name} is offline. try to reconnect...`);
            try {
                await this.qb.auth.login(this.username, this.password);
                this.checkOnline();
            } catch (e) {}
            if (!this.online) {
                console.log(`server ${this.name} reconnect failed.`);
            } else {
                console.log(`server ${this.name} reconnect success.`);
            }
        }
    }

    info() {
        return {
            name: this.name,
            qbURL: this.qbURL,
            webseedURL: this.webseedURL,
            category: this.category,
            ratioLimit: this.ratioLimit,
            seedingTimeLimit: this.seedingTimeLimit,
            sequentialDownload: this.sequentialDownload,
            firstLastPiecePrio: this.firstLastPiecePrio,
            online: this.online,
        };
    }

    async torrentsInfo(p?: TorrentInfoParameters) {
        let t: TorrentInfoParameters | any;
        if (!p) {
            t = {
                filter: "all",
                category: this.category,
            };
        } else {
            t = p;
            t.category = this.category;
        }
        return await this.qb.torrents.info(t);
    }

    async torrentsAdd(torrent: magnet.Instance) {
        let uri = toMagnetURI(torrent);
        let t: TorrentAddParameters | any = {
            urls: uri,
            category: this.category,
            ratioLimit: this.ratioLimit,
            seedingTimeLimit: this.seedingTimeLimit,
            sequentialDownload: this.sequentialDownload,
            firstLastPiecePrio: this.firstLastPiecePrio,
        };
        return await this.qb.torrents.add(t);
    }
}

class qbServerList {
    qbservers: qbServer[];
    auth: {} = {};
    app: {} = {};
    log: {} = {};
    sync: {} = {};
    transfer: {} = {};
    torrents: {} = {};
    search: {} = {};

    constructor(serverlist: any[]) {
        this.qbservers = [];
        for (let i = 0; i < serverlist.length; i++) {
            try {
                this.qbservers.push(new qbServer(serverlist[i]));
            } catch (e) {
                console.log(e);
            }
        }
    }

    serverinfo() {
        let serverInfo = [];
        for (let i = 0; i < this.qbservers.length; i++) {
            serverInfo.push(this.qbservers[i].info());
        }
        return { info: serverInfo };
    }

    async torrentsInfo(p?: TorrentInfoParameters) {
        let results = [];
        for (let s of this.qbservers) {
            results.push(s.torrentsInfo(p));
        }
        let resdict = await processPromisesDict(results);
        return resdict;
    }

    async torrentsAdd(torrent: magnet.Instance) {
        let results = [];
        for (let i = 0; i < this.qbservers.length; i++) {
            if (this.qbservers[i].online) {
                results.push(this.qbservers[i].torrentsAdd(torrent));
            }
        }
        results = await processPromises(results);

        let resdict: { [key: string]: any } = {
            info: {},
            magnetURI: undefined,
        };
        for (let i = 0; i < results.length; i++) {
            resdict.info[this.qbservers[i].name] = results[i];
        }
        let p: TorrentInfoParameters | any = {
            filter: "all",
            hashes: torrent.infoHash,
        };
        let tinfo = await this.torrentsInfo(p);
        for (let value of Object.values(tinfo)) {
            resdict.magnetURI = resdict.magnetURI || value[0]?.magnet_uri;
        }
        return resdict;
    }

    async torrentsDelete(torrent: magnet.Instance) {
        let delres = [];
        for (let s of this.qbservers) {
            delres.push(s.qb.torrents.delete(torrent.infoHash!, true));
        }
        let resdict = await processPromisesDict(delres);
        return resdict;
    }
}

var qbserverlist = new qbServerList(config.qbservers);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 在/api/v1/reload 接收GET请求，重新加载配置文件， 需要判断authtoken是否正确
app.get("/api/v1/reload", (req, res) => {
    if (req.query.authtoken == config.authtoken) {
        try {
            let config1 = YAML.parse(fs.readFileSync(configPath, "utf8"));
            let qbserverlist1 = new qbServerList(config1.qbservers);
            config = config1;
            qbserverlist = qbserverlist1;
            res.json({ info: "reloaded" });
        } catch (e) {
            res.json({ info: "error" });
        }
    } else {
        res.json({ info: "wrong" });
    }
});

// 在 /api/v1/torrents/add 接收POST请求，其中包含了种子的magnet链接，然后将其添加到服务器
app.post(
    "/api/v1/torrents/add",
    asyncHandler(async (req, res) => {
        let magnetURI = req.body.magnetURI;
        let torrent = await parseTorrent(magnetURI);
        let resdict = await qbserverlist.torrentsAdd(torrent);
        res.json(resdict);
    })
);

app.post(
    "/api/v1/torrents/delete",
    asyncHandler(async (req, res) => {
        let hash = req.body.hash;
        let torrent = await parseTorrent(hash);
        let resdict = await qbserverlist.torrentsDelete(torrent);
        res.json(resdict);
    })
);

app.use(
    "/api/v1/bangumi.moe",
    createProxyMiddleware({
        target: "https://bangumi.moe",
        changeOrigin: true,
        agent: proxyAgent,
        pathRewrite: {
            "^/api/v1/bangumi.moe": "",
        },
    })
);

// 在 /api/v1/servers/get 接收GET请求，返回服务器的信息
app.get("/api/v1/servers/get", (req, res) => {
    res.json(qbserverlist.serverinfo());
});

const port = config.port || 80;
app.listen(port, () => {
    console.log(`Server started at http://0.0.0.0:${port}`);
});
