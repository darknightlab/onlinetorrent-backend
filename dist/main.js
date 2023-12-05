// typescript
import fs from "fs";
import YAML from "yaml";
import express from "express";
import parseTorrent from "parse-torrent";
import { toMagnetURI } from "parse-torrent";
import { qBittorrentClient } from "@robertklep/qbittorrent";
import asyncHandler from "express-async-handler";
import cors from "cors";
const configPath = "./config/config.yaml";
var config = YAML.parse(fs.readFileSync(configPath, "utf8"));
class qbServer {
    name;
    qbURL;
    webseedURL;
    username;
    password;
    category;
    ratioLimit;
    seedingTimeLimit; // minutes
    sequentialDownload;
    firstLastPiecePrio;
    online = false;
    qb;
    checkOnlineTimer;
    constructor(serverObj) {
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
            }
            else {
                this.online = false;
            }
        }
        catch (e) {
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
    async addTorrent(torrent) {
        let uri = toMagnetURI(torrent);
        let t = {
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
    qbservers;
    auth = {};
    app = {};
    log = {};
    sync = {};
    transfer = {};
    torrents = {
        info: async (i) => {
            let resdict = {};
            for (let s of this.qbservers) {
                try {
                    let r = await s.qb.torrents.info(i);
                    resdict[s.name] = r;
                }
                catch (e) {
                    console.log(e);
                }
            }
            return resdict;
        },
    };
    search = {};
    constructor(serverlist) {
        this.qbservers = [];
        for (let i = 0; i < serverlist.length; i++) {
            try {
                this.qbservers.push(new qbServer(serverlist[i]));
            }
            catch (e) {
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
    async addTorrent(torrent) {
        let results = [];
        for (let i = 0; i < this.qbservers.length; i++) {
            results.push(this.qbservers[i].addTorrent(torrent));
        }
        results = await Promise.all(results);
        let resdict = {
            info: {},
            magnetURI: undefined,
        };
        for (let i = 0; i < results.length; i++) {
            resdict.info[this.qbservers[i].name] = results[i];
        }
        let i = {
            filter: "all",
            hashes: torrent.infoHash,
        };
        let tinfo = await this.torrents.info(i);
        for (let value of Object.values(tinfo)) {
            resdict.magnetURI = resdict.magnetURI || value[0].magnet_uri;
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
        }
        catch (e) {
            res.json({ info: "error" });
        }
    }
    else {
        res.json({ info: "wrong" });
    }
});
// 在 /api/v1/torrents/add 接收POST请求，其中包含了种子的magnet链接，然后将其添加到服务器
app.post("/api/v1/torrents/add", asyncHandler(async (req, res) => {
    let magnetURI = req.body.magnetURI;
    let torrent = await parseTorrent(magnetURI);
    let resdict = await qbserverlist.addTorrent(torrent);
    res.json(resdict);
}));
// 在 /api/v1/servers/get 接收GET请求，返回服务器的信息
app.get("/api/v1/servers/get", (req, res) => {
    res.json(qbserverlist.serverinfo());
});
const port = config.port || 80;
app.listen(port, () => {
    console.log(`Server started at http://0.0.0.0:${port}`);
});
//# sourceMappingURL=main.js.map