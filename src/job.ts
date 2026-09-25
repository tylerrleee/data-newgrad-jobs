export interface Job {
  /** Unique within its source and stable across runs; used to skip jobs already posted. */
  id: string;
  title: string;
  company: string;
  url: string;
  location?: string;
}

export interface JobSource {
  /** Short, unique name. Combined with each job's `id` to track what has been posted. */
  name: string;
  fetchJobs(): Promise<Job[]>;
}
