import {Target} from "../@types/target";
import fs from "fs";
import path from "path";
import {RateLimiter} from "./rateLimiter";
import {EmailService} from "./email";
import {describeIssue} from "./validate";
import {targetSchema} from "../models/target";

export class TargetManager {

    public static targets: Map<string, Target> = new Map<string, Target>();

    private static path: string = process.env.TARGETS_DIR ?? "targets";

    /**
     * Read and validate all targets. Throws if the directory cannot be read or a target is invalid.
     * Nothing is changed until everything is valid.
     */
    private static readAll(): Map<string, Target> {

        let files: string[];

        try {
            files = fs.readdirSync(this.path);
        } catch (e) {
            throw new Error("Cannot load targets: " + e);
        }

        const loaded = new Map<string, Target>();

        for(let targetFileName of files.filter((file) => file.endsWith(".json"))) {

            const targetName = path.basename(targetFileName, path.extname(targetFileName));
            let target: any;

            try {
                target = JSON.parse(fs.readFileSync(path.join(this.path, targetFileName)).toString());
            } catch (e) {
                throw new Error("Target " + targetName + " is not valid JSON: " + e.message);
            }

            this.validateTarget(targetName, target);
            loaded.set(targetName, <Target>target);

        }

        return loaded;

    }

    /**
     * Load all targets from the targets directory. Replaces the current targets.
     * Throws (and keeps the previous targets) if anything is invalid.
     */
    public static load(): void {

        console.log("Loading targets...");

        const loaded = this.readAll();

        // Build everything first, then swap, so a failure leaves the running state untouched
        const limiters = new Map();
        const transports = new Map();

        loaded.forEach((target, targetName) => {
            limiters.set(targetName, RateLimiter.create(target.rateLimit));
            transports.set(targetName, EmailService.createTransport(target.smtp));
        });

        RateLimiter.replace(limiters);
        EmailService.replace(transports);
        this.targets = loaded;

        loaded.forEach((_, targetName) => console.log("* Loaded target: " + targetName));

    }

    /**
     * Validate a target object and throw a readable error if it is invalid.
     * @param targetName (file-)name of the target
     * @param target The target object
     * @private
     */
    private static validateTarget(targetName: string, target: Target): void {

        const result = targetSchema.safeParse(target);

        if(result.success) return;

        const problems = result.error.issues.map((issue) => {
            const problem = describeIssue(issue);
            return (problem.field || "target") + ": " + problem.violated;
        });

        throw new Error("Target " + targetName + " is invalid: " + problems.join("; "));

    }

}
