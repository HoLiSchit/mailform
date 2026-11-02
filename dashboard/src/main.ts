import { loadConfig } from "./config";
import { createApp } from "./app";
import { Reloader } from "./reload";
import { TargetStore } from "./targets";

let config;
try {
    config = loadConfig(process.env);
} catch (e) {
    console.error((e as Error).message);
    process.exit(1);
}

const reloader = new Reloader({ mode: config.reloadMode, container: config.container });
const app = createApp(config, new TargetStore(config.targetsDir), reloader);

const server = app.listen(config.port, "127.0.0.1", () => {
    console.log(`mailform-dashboard listening on 127.0.0.1:${config.port} (reload mode: ${config.reloadMode})`);
});

const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
