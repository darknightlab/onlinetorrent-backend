// typescript
import fs from "fs";
import YAML from "yaml";
import express from "express";
import WebTorrent from "webtorrent";
import parseTorrent from "parse-torrent";
import { toMagnetURI, toTorrentFile } from "parse-torrent";
import magnet from "magnet-uri";
import { qBittorrentClient, TorrentAddParameters } from "@robertklep/qbittorrent";
import asyncHandler from "express-async-handler";
import cors from "cors";

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

    qb: qBittorrentClient;
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
        const torrentInfo = await this.qb.torrents.add(t);
        return torrentInfo;
    }
}

var qbservers: qbServer[] = [];
for (let i = 0; i < config.qbservers.length; i++) {
    qbservers.push(new qbServer(config.qbservers[i]));
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

async function sendToServers(t: magnet.Instance) {
    let results = [];
    for (let i = 0; i < qbservers.length; i++) {
        results.push(qbservers[i].addTorrent(t));
    }
    results = await Promise.all(results);

    let resdict: { [key: string]: any } = {};
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
                qbservers1.push(new qbServer(config.qbservers[i]));
            }
            config = config1;
            qbservers = qbservers1;
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
        let resdict = await sendToServers(torrent);
        res.json({ info: resdict });
    })
);

const port = config.port | 80;
app.listen(port, () => {
    console.log(`Server started at http://0.0.0.0:${port}`);
});
