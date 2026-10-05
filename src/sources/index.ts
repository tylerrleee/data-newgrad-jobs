import type { JobSource } from "../job.ts";
import { ecrSource } from "./ecr.ts";
import { simplifySource } from "./simplify.ts";
import { speedyapplySources } from "./speedyapply.ts";
import { zapplySource } from "./zapply.ts";

// ECR goes first so its request goes out at the recorded attempt time, keeping an hourly timer
// clear of its 55-minute interval. zshah101 (zshah.ts) lists only internships, so it isn't read.
export const sources: JobSource[] = [ecrSource(), simplifySource(), ...speedyapplySources(), zapplySource()];
