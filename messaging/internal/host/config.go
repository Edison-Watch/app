package host

import (
	"errors"
	"os"
	"path/filepath"
	"sync"

	"gopkg.in/yaml.v3"
)

// Config is the persisted, user-editable part of the messaging setup. It
// lives in config.yaml in the data directory.
type Config struct {
	IRC IRCConfig `yaml:"irc"`

	path string
	lock sync.Mutex
}

type IRCConfig struct {
	Networks map[string]*IRCNetwork `yaml:"networks"`
}

type IRCNetwork struct {
	DisplayName string `yaml:"displayname" json:"displayname"`
	Address     string `yaml:"address" json:"address"`
	TLS         bool   `yaml:"tls" json:"tls"`
}

func defaultConfig() *Config {
	return &Config{IRC: IRCConfig{Networks: map[string]*IRCNetwork{
		"libera": {DisplayName: "Libera.Chat", Address: "irc.libera.chat:6697", TLS: true},
	}}}
}

func LoadConfig(dataDir string) (*Config, error) {
	path := filepath.Join(dataDir, "config.yaml")
	cfg := defaultConfig()
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		cfg.path = path
		return cfg, cfg.Save()
	} else if err != nil {
		return nil, err
	}
	cfg = &Config{}
	if err = yaml.Unmarshal(data, cfg); err != nil {
		return nil, err
	}
	if cfg.IRC.Networks == nil {
		cfg.IRC.Networks = map[string]*IRCNetwork{}
	}
	cfg.path = path
	return cfg, nil
}

func (c *Config) Save() error {
	c.lock.Lock()
	defer c.lock.Unlock()
	data, err := yaml.Marshal(c)
	if err != nil {
		return err
	}
	tmp := c.path + ".tmp"
	if err = os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, c.path)
}
