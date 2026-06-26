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

      perSystem = {
        system,
        self',
        ...
      }: let
        overlays = [inputs.rust-overlay.overlays.default];
        pkgs = import inputs.nixpkgs {
          inherit system overlays;
        };

        rustToolchain = pkgs.rust-bin.fromRustupToolchainFile ./rust-toolchain.toml;

        cargoToml = builtins.fromTOML (builtins.readFile ./src-tauri/Cargo.toml);
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

        rustPlatform = pkgs.makeRustPlatform {
          cargo = rustToolchain;
          rustc = rustToolchain;
        };

        frontend = pkgs.buildNpmPackage {
          pname = "querymt-desktop-frontend";
          version = cargoToml.package.version;
          src = ./.;
          npmDeps = pkgs.importNpmLock {
            npmRoot = ./.;
          };
          npmConfigHook = pkgs.importNpmLock.npmConfigHook;
          npmBuildScript = "build";
          installPhase = ''
            runHook preInstall
            mkdir -p $out
            cp -r build/. $out/
            runHook postInstall
          '';
          doCheck = false;
        };

        querymt-desktop = rustPlatform.buildRustPackage {
          pname = "querymt-desktop";
          version = cargoToml.package.version;
          src = ./src-tauri;

          cargoLock = {
            lockFile = ./src-tauri/Cargo.lock;
            allowBuiltinFetchGit = true;
          };

          nativeBuildInputs = with pkgs; [
            pkg-config
            makeWrapper
            jq
          ];

          buildInputs = tauriLibs;

          # Nix uses cargo directly (not `tauri build`), so enable embedded assets explicitly.
          cargoBuildFlags = ["--features" "custom-protocol"];

          preBuild = ''
            FRONTEND_DIR="$PWD/../build"
            mkdir -p "$FRONTEND_DIR"
            cp -r ${frontend}/. "$FRONTEND_DIR/"

            # Patch tauri.conf.json to use an absolute path for frontendDist
            # so tauri_build reliably finds the assets inside the Nix sandbox.
            # Also remove devUrl so the production binary never attempts a dev-server connection.
            jq --arg dist "$FRONTEND_DIR" '.build.frontendDist = $dist | del(.build.devUrl)' tauri.conf.json > tauri.conf.json.tmp && mv tauri.conf.json.tmp tauri.conf.json
          '';

          doCheck = false;

          postFixup = ''
            wrapProgram $out/bin/querymt-desktop \
              --prefix LD_LIBRARY_PATH : "${pkgs.lib.makeLibraryPath tauriLibs}"
          '';
        };
      in {
        packages = {
          default = querymt-desktop;
          querymt-desktop = querymt-desktop;
        };

        apps = {
          default = {
            type = "app";
            program = "${self'.packages.querymt-desktop}/bin/querymt-desktop";
          };
        };

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