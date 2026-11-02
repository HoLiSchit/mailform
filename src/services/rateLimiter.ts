import {RateLimiterMemory} from "rate-limiter-flexible";
import {TargetRateLimit} from "../@types/target";

export class RateLimiter {

    private static limiters: Map<string, RateLimiterMemory> = new Map<string, RateLimiterMemory>();

    /**
     * Create a limiter for one target without registering it
     */
    public static create(limits: TargetRateLimit): RateLimiterMemory {
        return new RateLimiterMemory({
            duration: limits.timespan,
            points: limits.requests
        });
    }

    /**
     * Replace all registered limiters at once (used when targets are reloaded)
     */
    public static replace(limiters: Map<string, RateLimiterMemory>): void {
        this.limiters = limiters;
    }

    /**
     * Consume one point of a target's rate limiter
     * @param target (file-)name of a target
     * @param identifier Rate limiter identifier (ip address)
     */
    public static async consume(target, identifier): Promise<boolean> {

        let rateLimiter: RateLimiterMemory = this.limiters.get(target);

        if(!rateLimiter) return false;

        try {
            await rateLimiter.consume(identifier, 1);
        } catch (e) {
            return false;
        }

        return true;
    }

}