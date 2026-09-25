function required(name: string): string {
  const value = Bun.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

export const config = {
  slackBotToken: required("SLACK_BOT_TOKEN"),
  slackChannelId: required("SLACK_CHANNEL_ID"),
  dbPath: Bun.env.JOBBO_DB_PATH ?? "jobbo.sqlite",
};
