import express, {Application} from "express";
import {Server} from "http";
import {AddressInfo} from "net";
import {TargetManager} from "./services/targetManager";
import routes from "./router";

// Start express app
const port = process.env.PORT || 0;
const trustProxy: boolean = (process.env.PROXY === "true");

const app: Application = express();

app.set("trust proxy", trustProxy);
app.set("x-powered-by", false);

// Middlewares
app.use(express.json());

// Health check for Docker/monitoring (does not touch any target)
app.get("/healthz", (req, res) => res.status(200).send("ok"));

// Load targets. An invalid target stops the start, so a broken config is noticed immediately.
try {
    TargetManager.load();
} catch (e) {
    console.error("Error: " + e.message);
    process.exit(1);
}

app.use(routes);

// Create server
const server: Server = app.listen(port, () => {
    let { port } = server.address() as AddressInfo;
    console.log("MailForm started on port " + port);
});

// SIGHUP reloads the targets without a restart. An invalid config is rejected and the old one stays active.
process.on("SIGHUP", () => {
    try {
        TargetManager.load();
        console.log("Targets reloaded");
    } catch (e) {
        console.error("Reload failed: " + e.message);
    }
});

// Finish running requests before stopping (docker stop sends SIGTERM)
const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
