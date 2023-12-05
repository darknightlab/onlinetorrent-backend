// typescript
import fs from "fs";
import YAML from "yaml";
import express from "express";
import parseTorrent from "parse-torrent";
import { toMagnetURI, toTorrentFile } from "parse-torrent";
import magnet from "magnet-uri";
import { qBittorrentClient, TorrentAddParameters } from "@robertklep/qbittorrent";
import asyncHandler from "express-async-handler";
import cors from "cors";
import { info } from "console";

const configPath = "./config/config.yaml";
var config = YAML.parse(fs.readFileSync(configPath, "utf8"));

class qbServer {
    name: string;
    qbURL: string;
    webseedURL: string;
    username: string;
    password: string;
    category: string;
    ratioLimit: number;
    seedingTimeLimit: number; // minutes
    sequentialDownload: boolean;
    firstLastPiecePrio: boolean;
    online: boolean = false;
    qb: qBittorrentClient;
    checkOnlineTimer: NodeJS.Timeout;

    constructor(serverObj: any) {
        this.name = serverObj.name;
        this.qbURL = serverObj.qbURL;
        this.webseedURL = serverObj.webseedURL;
        this.username = serverObj.username;
        this.password = serverObj.password;
        this.category = serverObj.category || "projectk";
        this.ratioLimit = serverObj.ratioLimit || 0;
        this.seedingTimeLimit = serverObj.seedingTimeLimit || 0;
        this.sequentialDownload = serverObj.sequentialDownload || true;
        this.firstLastPiecePrio = serverObj.firstLastPiecePrio || true;
        this.qb = new qBittorrentClient(this.qbURL, this.username, this.password);
        this.online = true;

        this.checkOnlineTimer = setInterval(() => {
            this.checkOnline();
        }, 5 * 60 * 1000);
    }

    async checkOnline() {
        try {
            let res = await this.qb.app.version();
            if (res) {
                this.online = true;
            } else {
                this.online = false;
            }
        } catch (e) {
            this.online = false;
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

    async addTorrent(torrent: magnet.Instance) {
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

    info() {
        let serverInfo = [];
        for (let i = 0; i < this.qbservers.length; i++) {
            serverInfo.push(this.qbservers[i].info());
        }
        return { info: serverInfo };
    }

    async addTorrent(torrent: magnet.Instance) {
        let results = [];
        for (let i = 0; i < this.qbservers.length; i++) {
            results.push(this.qbservers[i].addTorrent(torrent));
        }
        results = await Promise.all(results);

        let resdict: { [key: string]: any } = {};
        for (let i = 0; i < results.length; i++) {
            resdict[this.qbservers[i].name] = results[i];
        }
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
        let resdict = await qbserverlist.addTorrent(torrent);
        res.json({ info: resdict });
    })
);

// 在 /api/v1/servers/get 接收GET请求，返回服务器的信息
app.get("/api/v1/servers/get", (req, res) => {
    res.json(qbserverlist.info());
});

const port = config.port | 80;
app.listen(port, () => {
    console.log(`Server started at http://0.0.0.0:${port}`);
});
