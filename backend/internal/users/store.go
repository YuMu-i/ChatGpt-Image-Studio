package users

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/mail"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"chatgpt2api/internal/config"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

const (
	RoleAdmin = "admin"
	RoleUser  = "user"
)

var (
	ErrNotFound           = errors.New("user not found")
	ErrEmailExists        = errors.New("email already exists")
	ErrInvalidCredentials = errors.New("invalid email or password")
	ErrUserDisabled       = errors.New("user is disabled")
	ErrLastAdminRequired  = errors.New("at least one enabled admin is required")
)

type Record struct {
	ID           string `json:"id"`
	Email        string `json:"email"`
	PasswordHash string `json:"password_hash"`
	Role         string `json:"role"`
	Disabled     bool   `json:"disabled"`
	CreatedAt    string `json:"created_at"`
	LastLoginAt  string `json:"last_login_at,omitempty"`
}

type PublicUser struct {
	ID          string `json:"id"`
	Email       string `json:"email"`
	Role        string `json:"role"`
	Disabled    bool   `json:"disabled"`
	CreatedAt   string `json:"created_at"`
	LastLoginAt string `json:"last_login_at,omitempty"`
}

type Update struct {
	Role     *string
	Disabled *bool
}

type envelope struct {
	Users []Record `json:"users"`
}

type Store struct {
	path  string
	mu    sync.RWMutex
	users map[string]Record
}

func NewStore(cfg *config.Config) (*Store, error) {
	path := cfg.ResolvePath(cfg.Storage.UsersFile)
	if strings.TrimSpace(path) == "" {
		return nil, fmt.Errorf("storage.users_file is required")
	}

	store := &Store{
		path:  path,
		users: map[string]Record{},
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	if err := store.load(); err != nil {
		return nil, err
	}
	return store, nil
}

func (s *Store) Register(email, password string) (PublicUser, error) {
	normalizedEmail, err := normalizeEmail(email)
	if err != nil {
		return PublicUser{}, err
	}
	if err := validatePassword(password); err != nil {
		return PublicUser{}, err
	}

	passwordHash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return PublicUser{}, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if s.findByEmailLocked(normalizedEmail) != nil {
		return PublicUser{}, ErrEmailExists
	}

	role := RoleUser
	if s.countEnabledAdminsLocked() == 0 {
		role = RoleAdmin
	}

	record := Record{
		ID:           uuid.NewString(),
		Email:        normalizedEmail,
		PasswordHash: string(passwordHash),
		Role:         role,
		Disabled:     false,
		CreatedAt:    time.Now().UTC().Format(time.RFC3339Nano),
	}
	s.users[record.ID] = record
	if err := s.saveLocked(); err != nil {
		delete(s.users, record.ID)
		return PublicUser{}, err
	}
	return toPublicUser(record), nil
}

func (s *Store) Authenticate(email, password string) (PublicUser, error) {
	normalizedEmail, err := normalizeEmail(email)
	if err != nil {
		return PublicUser{}, ErrInvalidCredentials
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	record := s.findByEmailLocked(normalizedEmail)
	if record == nil {
		return PublicUser{}, ErrInvalidCredentials
	}
	if record.Disabled {
		return PublicUser{}, ErrUserDisabled
	}
	if err := bcrypt.CompareHashAndPassword([]byte(record.PasswordHash), []byte(password)); err != nil {
		return PublicUser{}, ErrInvalidCredentials
	}

	record.LastLoginAt = time.Now().UTC().Format(time.RFC3339Nano)
	s.users[record.ID] = *record
	if err := s.saveLocked(); err != nil {
		return PublicUser{}, err
	}
	return toPublicUser(*record), nil
}

func (s *Store) Get(id string) (PublicUser, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	record, ok := s.users[strings.TrimSpace(id)]
	if !ok {
		return PublicUser{}, ErrNotFound
	}
	return toPublicUser(record), nil
}

func (s *Store) List() ([]PublicUser, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	items := make([]PublicUser, 0, len(s.users))
	for _, record := range s.users {
		items = append(items, toPublicUser(record))
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].CreatedAt > items[j].CreatedAt
	})
	return items, nil
}

func (s *Store) Update(id string, update Update) (PublicUser, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	record, ok := s.users[strings.TrimSpace(id)]
	if !ok {
		return PublicUser{}, ErrNotFound
	}

	original := record
	if update.Role != nil {
		record.Role = normalizeRole(*update.Role)
	}
	if update.Disabled != nil {
		record.Disabled = *update.Disabled
	}

	if record.Role != RoleAdmin && original.Role == RoleAdmin && s.countEnabledAdminsAfterLocked(record.ID, record) == 0 {
		return PublicUser{}, ErrLastAdminRequired
	}
	if record.Disabled && original.Role == RoleAdmin && s.countEnabledAdminsAfterLocked(record.ID, record) == 0 {
		return PublicUser{}, ErrLastAdminRequired
	}
	if record.Role != RoleAdmin && record.Disabled && s.countEnabledAdminsAfterLocked(record.ID, record) == 0 {
		return PublicUser{}, ErrLastAdminRequired
	}

	s.users[record.ID] = record
	if err := s.saveLocked(); err != nil {
		s.users[original.ID] = original
		return PublicUser{}, err
	}
	return toPublicUser(record), nil
}

func (s *Store) HasUsers() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.users) > 0
}

func (s *Store) EmailExists(email string) bool {
	normalizedEmail, err := normalizeEmail(email)
	if err != nil {
		return false
	}

	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.findByEmailLocked(normalizedEmail) != nil
}

func (s *Store) load() error {
	raw, err := os.ReadFile(s.path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	if len(raw) == 0 {
		return nil
	}

	var payload envelope
	if err := json.Unmarshal(raw, &payload); err != nil {
		return err
	}

	for _, item := range payload.Users {
		item.Email = strings.ToLower(strings.TrimSpace(item.Email))
		item.Role = normalizeRole(item.Role)
		if strings.TrimSpace(item.ID) == "" || strings.TrimSpace(item.Email) == "" {
			continue
		}
		s.users[item.ID] = item
	}
	return nil
}

func (s *Store) saveLocked() error {
	items := make([]Record, 0, len(s.users))
	for _, item := range s.users {
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].CreatedAt < items[j].CreatedAt
	})

	payload := envelope{Users: items}
	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, append(data, '\n'), 0o644)
}

func (s *Store) findByEmailLocked(email string) *Record {
	for _, item := range s.users {
		if item.Email == email {
			copy := item
			return &copy
		}
	}
	return nil
}

func (s *Store) countEnabledAdminsLocked() int {
	count := 0
	for _, item := range s.users {
		if item.Role == RoleAdmin && !item.Disabled {
			count++
		}
	}
	return count
}

func (s *Store) countEnabledAdminsAfterLocked(targetID string, replacement Record) int {
	count := 0
	for id, item := range s.users {
		current := item
		if id == targetID {
			current = replacement
		}
		if current.Role == RoleAdmin && !current.Disabled {
			count++
		}
	}
	return count
}

func toPublicUser(record Record) PublicUser {
	return PublicUser{
		ID:          record.ID,
		Email:       record.Email,
		Role:        normalizeRole(record.Role),
		Disabled:    record.Disabled,
		CreatedAt:   record.CreatedAt,
		LastLoginAt: record.LastLoginAt,
	}
}

func normalizeEmail(value string) (string, error) {
	normalized := strings.ToLower(strings.TrimSpace(value))
	if normalized == "" {
		return "", fmt.Errorf("email is required")
	}
	if _, err := mail.ParseAddress(normalized); err != nil {
		return "", fmt.Errorf("email is invalid")
	}
	return normalized, nil
}

func normalizeRole(value string) string {
	if strings.EqualFold(strings.TrimSpace(value), RoleAdmin) {
		return RoleAdmin
	}
	return RoleUser
}

func validatePassword(password string) error {
	if len(strings.TrimSpace(password)) < 6 {
		return fmt.Errorf("password must be at least 6 characters")
	}
	return nil
}
