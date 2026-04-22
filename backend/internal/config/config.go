package config

import (
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"

	"github.com/BurntSushi/toml"
)

const (
	defaultConfigFile = "config.defaults.toml"
	userConfigFile    = "config.toml"
	dataDirName       = "data"
)

type Paths struct {
	Root     string
	Defaults string
	Override string
}

type AppConfig struct {
	Name            string `toml:"name"`
	Version         string `toml:"version"`
	APIKey          string `toml:"api_key"`
	AuthKey         string `toml:"auth_key"`
	ImageFormat     string `toml:"image_format"`
	MaxUploadSizeMB int    `toml:"max_upload_size_mb"`
}

type ServerConfig struct {
	Host      string `toml:"host"`
	Port      int    `toml:"port"`
	StaticDir string `toml:"static_dir"`
}

type ChatGPTConfig struct {
	Model          string `toml:"model"`
	SSETimeout     int    `toml:"sse_timeout"`
	PollInterval   int    `toml:"poll_interval"`
	PollMaxWait    int    `toml:"poll_max_wait"`
	RequestTimeout int    `toml:"request_timeout"`
}

type AccountsConfig struct {
	DefaultQuota        int  `toml:"default_quota"`
	PreferRemoteRefresh bool `toml:"prefer_remote_refresh"`
	RefreshWorkers      int  `toml:"refresh_workers"`
}

type StorageConfig struct {
	AuthDir      string `toml:"auth_dir"`
	StateFile    string `toml:"state_file"`
	SyncStateDir string `toml:"sync_state_dir"`
	ImageDir     string `toml:"image_dir"`
}

type SyncConfig struct {
	Enabled        bool   `toml:"enabled"`
	BaseURL        string `toml:"base_url"`
	ManagementKey  string `toml:"management_key"`
	RequestTimeout int    `toml:"request_timeout"`
	Concurrency    int    `toml:"concurrency"`
	ProviderType   string `toml:"provider_type"`
}

type LogConfig struct {
	LogAllRequests bool `toml:"log_all_requests"`
}

type Config struct {
	mu     sync.RWMutex `toml:"-"`
	loadMu sync.Mutex   `toml:"-"`
	loaded bool         `toml:"-"`
	paths  Paths        `toml:"-"`

	App      AppConfig      `toml:"app"`
	Server   ServerConfig   `toml:"server"`
	ChatGPT  ChatGPTConfig  `toml:"chatgpt"`
	Accounts AccountsConfig `toml:"accounts"`
	Storage  StorageConfig  `toml:"storage"`
	Sync     SyncConfig     `toml:"sync"`
	Log      LogConfig      `toml:"log"`
}

func New(rootDir string) *Config {
	return &Config{paths: resolvePaths(rootDir)}
}

func (c *Config) Load() error {
	c.loadMu.Lock()
	defer c.loadMu.Unlock()

	next := &Config{paths: c.paths}

	if !fileExists(c.paths.Defaults) {
		return fmt.Errorf("default config file not found: %s", c.paths.Defaults)
	}
	if _, err := toml.DecodeFile(c.paths.Defaults, next); err != nil {
		return fmt.Errorf("decode defaults: %w", err)
	}
	if fileExists(c.paths.Override) {
		if err := decodeOverrideFile(c.paths.Override, next); err != nil {
			return fmt.Errorf("decode override: %w", err)
		}
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	c.copyFrom(next)
	c.loaded = true
	return nil
}

func (c *Config) EnsureLoaded() error {
	c.mu.RLock()
	loaded := c.loaded
	c.mu.RUnlock()
	if loaded {
		return nil
	}
	return c.Load()
}

func (c *Config) GetString(key string, fallback ...string) string {
	value, ok := c.lookup(key)
	if !ok {
		return stringFallback(fallback)
	}
	switch typed := value.(type) {
	case string:
		return typed
	case fmt.Stringer:
		return typed.String()
	default:
		return stringFallback(fallback)
	}
}

func (c *Config) GetInt(key string, fallback ...int) int {
	value, ok := c.lookup(key)
	if !ok {
		return intFallback(fallback)
	}
	switch typed := value.(type) {
	case int:
		return typed
	case int8:
		return int(typed)
	case int16:
		return int(typed)
	case int32:
		return int(typed)
	case int64:
		return int(typed)
	case uint:
		return int(typed)
	case uint8:
		return int(typed)
	case uint16:
		return int(typed)
	case uint32:
		return int(typed)
	case uint64:
		return int(typed)
	default:
		return intFallback(fallback)
	}
}

func (c *Config) GetBool(key string, fallback ...bool) bool {
	value, ok := c.lookup(key)
	if !ok {
		return boolFallback(fallback)
	}
	typed, ok := value.(bool)
	if !ok {
		return boolFallback(fallback)
	}
	return typed
}

func (c *Config) Paths() Paths {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.paths
}

func (c *Config) RootDir() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.paths.Root
}

func (c *Config) ResolvePath(path string) string {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return c.RootDir()
	}
	if filepath.IsAbs(trimmed) {
		return trimmed
	}
	return filepath.Join(c.RootDir(), trimmed)
}

func (c *Config) SaveOverride(section, key string, value any) error {
	c.loadMu.Lock()
	defer c.loadMu.Unlock()

	raw := map[string]any{}
	if fileExists(c.paths.Override) {
		if _, err := toml.DecodeFile(c.paths.Override, &raw); err != nil {
			return fmt.Errorf("read override: %w", err)
		}
	}

	sec, ok := raw[section].(map[string]any)
	if !ok {
		sec = map[string]any{}
	}
	sec[key] = value
	raw[section] = sec

	if err := os.MkdirAll(filepath.Dir(c.paths.Override), 0o755); err != nil {
		return fmt.Errorf("create config dir: %w", err)
	}

	f, err := os.Create(c.paths.Override)
	if err != nil {
		return fmt.Errorf("create override file: %w", err)
	}
	defer f.Close()
	if err := toml.NewEncoder(f).Encode(raw); err != nil {
		return fmt.Errorf("encode override: %w", err)
	}

	next := &Config{paths: c.paths}
	if _, err := toml.DecodeFile(c.paths.Defaults, next); err != nil {
		return fmt.Errorf("reload defaults: %w", err)
	}
	if fileExists(c.paths.Override) {
		if err := decodeOverrideFile(c.paths.Override, next); err != nil {
			return fmt.Errorf("reload override: %w", err)
		}
	}

	c.mu.Lock()
	c.copyFrom(next)
	c.loaded = true
	c.mu.Unlock()
	return nil
}

func (c *Config) lookup(key string) (any, bool) {
	if err := c.EnsureLoaded(); err != nil {
		return nil, false
	}

	parts := strings.Split(key, ".")
	if len(parts) == 0 {
		return nil, false
	}

	c.mu.RLock()
	defer c.mu.RUnlock()

	current := reflect.ValueOf(c).Elem()
	for _, part := range parts {
		current = indirectValue(current)
		if !current.IsValid() || current.Kind() != reflect.Struct {
			return nil, false
		}
		next, ok := structFieldByTOMLTag(current, part)
		if !ok {
			return nil, false
		}
		current = next
	}

	current = indirectValue(current)
	if !current.IsValid() {
		return nil, false
	}
	return current.Interface(), true
}

func (c *Config) copyFrom(other *Config) {
	c.App = other.App
	c.Server = other.Server
	c.ChatGPT = other.ChatGPT
	c.Accounts = other.Accounts
	c.Storage = other.Storage
	c.Sync = other.Sync
	c.Log = other.Log
	c.paths = other.paths
}

func decodeOverrideFile(path string, target *Config) error {
	raw := map[string]any{}
	if _, err := toml.DecodeFile(path, &raw); err != nil {
		return err
	}
	return applyOverrideMap(reflect.ValueOf(target).Elem(), raw)
}

func applyOverrideMap(dst reflect.Value, raw map[string]any) error {
	for key, value := range raw {
		field, ok := structFieldByTOMLTag(dst, key)
		if !ok {
			continue
		}
		if err := setOverrideValue(field, value); err != nil {
			return err
		}
	}
	return nil
}

func setOverrideValue(dst reflect.Value, raw any) error {
	if !dst.CanSet() {
		return nil
	}
	dst = indirectValue(dst)
	if !dst.IsValid() {
		return nil
	}

	switch dst.Kind() {
	case reflect.Struct:
		nested, ok := raw.(map[string]any)
		if !ok {
			return fmt.Errorf("expected table, got %T", raw)
		}
		return applyOverrideMap(dst, nested)
	case reflect.String:
		text, ok := raw.(string)
		if !ok {
			return fmt.Errorf("expected string, got %T", raw)
		}
		dst.SetString(text)
	case reflect.Bool:
		flag, ok := raw.(bool)
		if !ok {
			return fmt.Errorf("expected bool, got %T", raw)
		}
		dst.SetBool(flag)
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		switch n := raw.(type) {
		case int64:
			dst.SetInt(n)
		case int:
			dst.SetInt(int64(n))
		case float64:
			dst.SetInt(int64(n))
		default:
			return fmt.Errorf("expected int, got %T", raw)
		}
	default:
		value := reflect.ValueOf(raw)
		if value.IsValid() && value.Type().AssignableTo(dst.Type()) {
			dst.Set(value)
			return nil
		}
		return fmt.Errorf("unsupported type %s", dst.Type())
	}
	return nil
}

func structFieldByTOMLTag(value reflect.Value, part string) (reflect.Value, bool) {
	valueType := value.Type()
	for i := 0; i < value.NumField(); i++ {
		fieldType := valueType.Field(i)
		if !fieldType.IsExported() {
			continue
		}
		tag := strings.Split(fieldType.Tag.Get("toml"), ",")[0]
		if tag == "-" {
			continue
		}
		if tag == "" {
			tag = strings.ToLower(fieldType.Name)
		}
		if tag == part {
			return value.Field(i), true
		}
	}
	return reflect.Value{}, false
}

func indirectValue(value reflect.Value) reflect.Value {
	for value.IsValid() && (value.Kind() == reflect.Pointer || value.Kind() == reflect.Interface) {
		if value.IsNil() {
			return reflect.Value{}
		}
		value = value.Elem()
	}
	return value
}

func resolvePaths(rootDir string) Paths {
	root := normalizeRoot(rootDir)
	return Paths{
		Root:     root,
		Defaults: filepath.Join(root, defaultConfigFile),
		Override: filepath.Join(root, dataDirName, userConfigFile),
	}
}

func normalizeRoot(rootDir string) string {
	if rootDir != "" {
		return rootDir
	}
	if cwd, err := os.Getwd(); err == nil {
		return cwd
	}
	return "."
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func stringFallback(values []string) string {
	if len(values) > 0 {
		return values[0]
	}
	return ""
}

func intFallback(values []int) int {
	if len(values) > 0 {
		return values[0]
	}
	return 0
}

func boolFallback(values []bool) bool {
	if len(values) > 0 {
		return values[0]
	}
	return false
}
