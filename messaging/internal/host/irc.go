package host

import (
	"context"
	"errors"
	"slices"
	"strings"

	"go.mau.fi/mautrix-irc/pkg/connector"
	"gopkg.in/yaml.v3"
	"maunium.net/go/mautrix/bridgev2"
)

// IRC wraps mautrix-irc. It is the test network: an IRC server is easy to
// run locally (ergo), so the whole flow can be exercised without accounts on
// a third-party service.
type IRC struct {
	conn *connector.IRCConnector
}

func NewIRC() *IRC { return &IRC{conn: &connector.IRCConnector{}} }

func (n *IRC) ID() string                           { return "irc" }
func (n *IRC) DisplayName() string                  { return "IRC" }
func (n *IRC) Connector() bridgev2.NetworkConnector { return n.conn }

func (n *IRC) Configure(cfg *Config) error {
	example, data, _ := n.conn.GetConfig()
	if err := yaml.Unmarshal([]byte(example), data); err != nil {
		return err
	}
	n.conn.Config.Identd.Address = "" // no identd listener on a desktop
	n.conn.Config.Networks = map[string]*connector.NetworkConfig{}
	for name, net := range cfg.IRC.Networks {
		n.SetNetwork(name, net)
	}
	return nil
}

// SetNetwork adds or replaces a network in the live connector config. The IRC
// connector reads this map at login and connect time, so no restart is needed.
func (n *IRC) SetNetwork(name string, net *IRCNetwork) {
	name = strings.ToLower(name)
	n.conn.Config.Networks[name] = &connector.NetworkConfig{
		DisplayName: net.DisplayName, Address: net.Address, TLS: net.TLS, Name: name,
	}
}

func (n *IRC) IsJoinIdentifier(identifier string) bool {
	return strings.HasPrefix(identifier, "#") || strings.HasPrefix(identifier, "&")
}

func (n *IRC) JoinChat(ctx context.Context, login *bridgev2.UserLogin, channel string) error {
	cli, ok := login.Client.(*connector.IRCClient)
	if !ok || cli.Conn == nil {
		return errors.New("this IRC account is not connected")
	}
	if err := cli.Conn.Join(channel); err != nil {
		return err
	}
	meta := login.Metadata.(*connector.UserLoginMetadata)
	if !slices.Contains(meta.Channels, channel) {
		meta.Channels = append(meta.Channels, channel)
		return login.Save(ctx)
	}
	return nil
}
