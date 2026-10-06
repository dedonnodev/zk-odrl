{
  description = "zk-odrl: ZK access control with ODRL policies (bachelor thesis)";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { nixpkgs, ... }:
    let
      # measurements are done on x86_64-linux only
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
    in
    {
      devShells = nixpkgs.lib.genAttrs systems (system:
        let pkgs = import nixpkgs { inherit system; };
        in {
          default = pkgs.mkShell {
            packages = with pkgs; [
              # circom 2 from nixpkgs (the npm "circom" package is the old circom 1)
              circom
              # for snarkjs and hardhat
              nodejs_22
            ];
          };
        });
    };
}
