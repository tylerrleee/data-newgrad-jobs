# Official Slack CLI (github.com/slackapi/slack-cli).
#
# Note: nixpkgs' `slack-cli` attribute is an unrelated bash script
# (rockymadden/slack-cli), so we build the official one ourselves.
#
# To bump: update `version`, set both hashes to `lib.fakeHash`, run
# `nix build .#slack-cli`, and copy the reported hashes back in.
{
  lib,
  buildGo127Module,
  fetchFromGitHub,
  installShellFiles,
  stdenv,
}:

buildGo127Module rec {
  pname = "slack-cli";
  version = "4.8.0";

  src = fetchFromGitHub {
    owner = "slackapi";
    repo = "slack-cli";
    rev = "v${version}";
    hash = "sha256-+50WpEYV6mohRW6jqsNLgzIQs7poRQNqH5v1bpaPCOE=";
  };

  vendorHash = "sha256-pneSwkRDSbGfTUTmIDOkkvVHH/W1qukGYURdIKdgU9U=";

  subPackages = [ "." ];

  env.CGO_ENABLED = 0;

  ldflags = [
    "-s"
    "-w"
    "-X github.com/slackapi/slack-cli/internal/version.Version=v${version}"
  ];

  # The test suite expects a git checkout and network access.
  doCheck = false;

  nativeBuildInputs = [ installShellFiles ];

  postInstall = ''
    mv $out/bin/slack-cli $out/bin/slack
  ''
  + lib.optionalString (stdenv.buildPlatform.canExecute stdenv.hostPlatform) ''
    # Generate one at a time: concurrent runs race creating ~/.slack/logs.
    export HOME=$TMPDIR
    for shell in bash fish zsh; do
      $out/bin/slack completion $shell > slack.$shell
    done
    installShellCompletion --cmd slack slack.{bash,fish,zsh}
  '';

  meta = {
    description = "Official command-line interface for building apps on the Slack Platform";
    homepage = "https://github.com/slackapi/slack-cli";
    changelog = "https://github.com/slackapi/slack-cli/releases/tag/v${version}";
    license = lib.licenses.asl20;
    mainProgram = "slack";
    platforms = lib.platforms.unix;
  };
}
