{
  description = "QueryMT Desktop development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
    rust-overlay.url = "github:oxalica/rust-overlay";
  };

  outputs = inputs:
    inputs.flake-parts.lib.mkFlake {inherit inputs;} {
      systems = inputs.nixpkgs.lib.systems.flakeExposed;

      perSystem = {system, ...}: let
        overlays = [inputs.rust-overlay.overlays.default];
        pkgs = import inputs.nixpkgs {
          inherit system overlays;
        };

        rustToolchain = pkgs.rust-bin.stable.latest.default;
        tauriLibs = with pkgs; [
          at-spi2-atk
          atk
          cairo
          dbus
          gdk-pixbuf
          glib
          gtk3
          libsoup_3
          openssl
          pango
          webkitgtk_4_1
        ];
      in {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            nodejs_24
            rustToolchain
            pkg-config
            openssl
            dbus
            glib
            gtk3
            libsoup_3
            webkitgtk_4_1
          ];

          LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath tauriLibs;
          PKG_CONFIG_PATH = pkgs.lib.makeSearchPath "lib/pkgconfig" tauriLibs;

          shellHook = ''
            export PS1="(dev:querymt-desktop) $PS1"
          '';
        };
      };
    };
}
