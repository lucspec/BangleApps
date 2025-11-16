{
  description = "BangleApps development with local GitHub Actions workflow testing";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.05";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        node = pkgs.nodejs_20;
        getOCI = ''
          # Check if there is an OCI socket.
          PREFIX=unix:///run/

          ### Start with rootless podman, then docker
          if [ -w $PREFIX/user/1000/podman/podman.sock ]; then
            export DOCKER_HOST=$PREFIX/user/1000/podman/podman.sock 

          elif [ -w $PREFIX/user/1000/docker/docker.sock ]; then
            export DOCKER_HOST=$PREFIX/user/1000/docker/docker.sock

          ### Fall back to rootful podman, then docker
          elif [ -w $PREFIX/podman/podman.sock ]; then
            export DOCKER_HOST=$PREFIX/podman/podman.sock 

          elif [ -w $PREFIX/docker/docker.sock ]; then
            export DOCKER_HOST=$PREFIX/docker/docker.sock

          ### If all else fails warn the user we couldn't find what we need
          else
            echo "You do not have a valid OCI socket as `act` requires"
            echo "`act` (local github workflows) will not work"
            echo "Start one and set DOCKER_HOST to proceed"
          fi
      '';

      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = [
            pkgs.git
            pkgs.python3
            pkgs.act  # Run GitHub Actions locally
            #pkgs.docker  # Required by act, assumed to already be installed
            
            node
          ];

          shellHook = ''
            echo "BangleApps development environment with GitHub Actions support"
            echo "=============================================================="
            echo "Node: $(node --version)"
            echo "npm: $(npm --version)"
            echo "act: $(act --version)"
            echo ""
            
            # Initialize submodules if needed
            if [ ! -f "core/.git" ] || [ ! -f "webtools/heatshrink/.git" ]; then
              echo "Initializing git submodules..."
              git submodule update --init --recursive
              echo ""
            fi
            
            # Install npm dependencies if needed
            if [ ! -d "node_modules" ]; then
              echo "Installing npm dependencies..."
              npm install
              echo ""
            fi
              
            ${getOCI}
            echo "Available commands:"
            echo "  npm test                    - Run tests locally"
            echo "  git submodule update --init - Initialize/update submodules"
            echo ""
            echo "  act                         - Run all GitHub workflows"
            echo "  act -l                      - List available workflows"
            echo "  act pull_request            - Run PR checks"
            echo "  act push                    - Run push workflows"
            echo "  act -j test                 - Run specific job 'test'"
            echo ""
            echo "  nix run .#run-workflow      - Run test workflow"
            echo "  nix run .#list-workflows    - List all workflows"
            echo "  nix run .#init-submodules   - Initialize submodules"
          '';
        };

        apps = {
          init-submodules = {
            type = "app";
            program = toString (pkgs.writeShellScript "init-submodules" ''
              set -e
              
              echo "Initializing git submodules..."
              ${pkgs.git}/bin/git submodule update --init --recursive
              
              echo ""
              echo "✓ Submodules initialized:"
              echo "  - core/"
              echo "  - webtools/heatshrink/"
            '');
          };

          test = {
            type = "app";
            program = toString (pkgs.writeShellScript "run-tests" ''
              set -e
              
              # Ensure submodules are initialized
              if [ ! -f "core/.git" ] || [ ! -f "webtools/heatshrink/.git" ]; then
                echo "Initializing submodules first..."
                ${pkgs.git}/bin/git submodule update --init --recursive
                echo ""
              fi
              
              # Install dependencies if needed
              if [ ! -d "node_modules" ]; then
                echo "Installing npm dependencies..."
                ${node}/bin/npm install
                echo ""
              fi
              
              # Run tests
              echo "Running tests..."
              ${node}/bin/npm test
            '');
          };

          run-workflow = {
            type = "app";
            program = toString (pkgs.writeShellScript "run-workflow" ''
              set -e

              ${getOCI}
              
              echo "Running GitHub workflow locally with act..."
              echo ""
              
              
              # Note about submodules
              echo "Note: The workflow will handle submodule initialization"
              echo "      (checkout action with submodules: true)"
              echo ""
              
              # Run act with verbose output
              ${pkgs.act}/bin/act \
                --container-architecture linux/amd64 \
                --verbose \
                "$@"
            '');
          };

          list-workflows = {
            type = "app";
            program = toString (pkgs.writeShellScript "list-workflows" ''
              echo "Available GitHub workflows:"
              echo ""
              ${pkgs.act}/bin/act -l
              echo ""
              echo "Run a workflow with:"
              echo "  nix run .#run-workflow -- [event] [options]"
              echo ""
              echo "Examples:"
              echo "  nix run .#run-workflow -- pull_request"
              echo "  nix run .#run-workflow -- push"
              echo "  nix run .#run-workflow -- -j test"
              echo "  nix run .#run-workflow -- --dryrun"
            '');
          };

          clean = {
            type = "app";
            program = toString (pkgs.writeShellScript "clean" ''
              echo "Cleaning build artifacts and submodules..."
              
              # Clean npm
              rm -rf node_modules
              
              # Clean submodules
              ${pkgs.git}/bin/git submodule deinit -f --all
              
              echo ""
              echo "✓ Cleaned. Run 'nix develop' to reinitialize."
            '');
          };

          default = self.apps.${system}.run-workflow;
        };
      }
    );
}
