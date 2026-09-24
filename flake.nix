{
  description = "jobbo - scrape job postings and post them to Slack";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      packages = forAllSystems (pkgs: {
        slack-cli = pkgs.callPackage ./nix/slack-cli.nix { };
      });

      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = [
            pkgs.bun
            self.packages.${pkgs.stdenv.hostPlatform.system}.slack-cli
          ];

          # The CLI is managed by nix, so its self-update prompt is just noise.
          SLACK_SKIP_UPDATE = "1";
        };
      });

      formatter = forAllSystems (pkgs: pkgs.nixfmt-tree);
    };
}
