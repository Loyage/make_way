# Copy to ~/nix-config/modules/linux/traffic-game.nix, then use `just switch`.
# This does not install the user service; run deploy/install-service.sh first.
{ myvars, ... }:
{
  networking.firewall.allowedTCPPorts = [ 8180 ];

  # Start the enabled user service on boot, including before interactive login,
  # and keep it running after logout.
  users.users.${myvars.username}.linger = true;
}
