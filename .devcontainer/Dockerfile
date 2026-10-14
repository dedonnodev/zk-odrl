# Only debian, nix and direnv. The tools come from flake.nix.
FROM docker.io/library/debian:trixie-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl xz-utils git less jq make procps \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd -g 1000 dev \
    && useradd -u 1000 -g 1000 -m -s /bin/bash dev \
    && mkdir -m 0755 /nix && chown 1000:1000 /nix

USER dev
ENV USER=dev \
    HOME=/home/dev \
    LANG=C.UTF-8 \
    NIX_SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt \
    PATH=/home/dev/.nix-profile/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# fixed versions (same nixpkgs revision as flake.lock)
ARG NIX_VERSION=2.35.2
ARG NIXPKGS_REV=0968519e14f7aa7d3e9b389682bd74d2b51c8ce8

RUN curl -fsSL https://releases.nixos.org/nix/nix-${NIX_VERSION}/install | sh -s -- --no-daemon \
    && mkdir -p ~/.config/nix \
    && printf 'experimental-features = nix-command flakes\nwarn-dirty = false\n' >> ~/.config/nix/nix.conf

RUN nix profile install github:NixOS/nixpkgs/${NIXPKGS_REV}#direnv \
        github:NixOS/nixpkgs/${NIXPKGS_REV}#nix-direnv \
    && mkdir -p ~/.config/direnv \
    && echo 'source $HOME/.nix-profile/share/nix-direnv/direnvrc' > ~/.config/direnv/direnvrc \
    && echo 'eval "$(direnv hook bash)"' >> ~/.bashrc

CMD ["sleep", "infinity"]
