import {z} from "zod";

export interface Problem {
    field: string;
    violated: string;
    expect: unknown;
}

/** Describe a zod issue in the form that API clients receive: field, violated rule, expected value. */
export function describeIssue(issue: z.core.$ZodIssue): Problem {
    const field = issue.path.join(".");

    switch(issue.code) {
        case "invalid_type":
            return issue.input === undefined
                ? {field, violated: "presence", expect: true}
                : {field, violated: "type", expect: issue.expected};
        case "too_small":
            return {field, violated: "length", expect: {minimum: Number(issue.minimum)}};
        case "too_big":
            return {field, violated: "length", expect: {maximum: Number(issue.maximum)}};
        case "invalid_format":
            return {field, violated: issue.format, expect: true};
        default:
            return {field, violated: issue.code, expect: true};
    }
}

/**
 * Validate request fields against a schema
 * @param fields Fields from the request body
 * @param schema zod schema describing the allowed fields
 */
function validate(fields: unknown, schema: z.ZodType) {
    const result = schema.safeParse(fields);

    if(result.success) {
        return { error: undefined, problems: undefined };
    }

    return { error: "validation_error", problems: result.error.issues.map(describeIssue) };
}

export default validate;
