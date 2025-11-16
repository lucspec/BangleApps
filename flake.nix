{
  description = "BangleApps development with local GitHub Actions workflow testing";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs_20
            git
            python3
            act  # Run GitHub Actions locally
            docker  # Required by act
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
                ${pkgs.nodejs_20}/bin/npm install
                echo ""
              fi
              
              # Run tests
              echo "Running tests..."
              ${pkgs.nodejs_20}/bin/npm test
            '');
          };

          run-workflow = {
            type = "app";
            program = toString (pkgs.writeShellScript "run-workflow" ''
              set -e
              
              echo "Running GitHub workflow locally with act..."
              echo ""
              
              # Check if Docker is running
              if ! ${pkgs.docker}/bin/docker info > /dev/null 2>&1; then
                echo "Error: Docker is not running. Please start Docker first."
                echo ""
                echo "On NixOS, you may need to enable Docker:"
                echo "  virtualisation.docker.enable = true;"
                echo ""
                echo "Or add yourself to the docker group:"
                echo "  users.users.<your-username>.extraGroups = [ \"docker\" ];"
                exit 1
              fi
              
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
