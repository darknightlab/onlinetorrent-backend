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
        const torrentInfo = await this.qb.torrents.add(t);
        return torrentInfo;
    }
}
var qbservers = [];
for (let i = 0; i < config.qbservers.length; i++) {
    try {
        qbservers.push(new qbServer(config.qbservers[i]));
    }
    catch (e) {
        console.log(e);
    }
}
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
async function sendToServers(t) {
    let results = [];
    for (let i = 0; i < qbservers.length; i++) {
        results.push(qbservers[i].addTorrent(t));
    }
    results = await Promise.all(results);
    let resdict = {};
    for (let i = 0; i < results.length; i++) {
        resdict[qbservers[i].name] = results[i];
    }
    return resdict;
}
// 在/api/v1/reload 接收GET请求，重新加载配置文件， 需要判断authtoken是否正确
app.get("/api/v1/reload", (req, res) => {
    if (req.query.authtoken == config.authtoken) {
        try {
            let config1 = YAML.parse(fs.readFileSync(configPath, "utf8"));
            let qbservers1 = [];
            for (let i = 0; i < config1.qbservers.length; i++) {
                try {
                    qbservers1.push(new qbServer(config.qbservers[i]));
                }
                catch (e) {
                    console.log(e);
                }
            }
            config = config1;
            qbservers = qbservers1;
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
    let resdict = await sendToServers(torrent);
    res.json({ info: resdict });
}));
// 在 /api/v1/servers/get 接收GET请求，返回服务器的信息
app.get("/api/v1/servers/get", (req, res) => {
    let serverInfo = [];
    for (let i = 0; i < qbservers.length; i++) {
        serverInfo.push(qbservers[i].info());
    }
    res.json({ info: serverInfo });
});
const port = config.port | 80;
app.listen(port, () => {
    console.log(`Server started at http://0.0.0.0:${port}`);
});
//# sourceMappingURL=main.js.map