package verification

import (
	"crypto/rand"
	"fmt"
	"math/big"
	"strings"
	"sync"
	"time"
)

var (
	ErrCodeNotFound    = fmt.Errorf("verification code not found or expired")
	ErrCodeMismatch    = fmt.Errorf("verification code is invalid")
	ErrCodeTooFrequent = fmt.Errorf("please wait before requesting another code")
)

type Entry struct {
	Code      string
	ExpiresAt time.Time
	ResendAt  time.Time
}

type Store struct {
	mu             sync.Mutex
	entries        map[string]Entry
	codeTTL        time.Duration
	resendInterval time.Duration
}

func NewStore(codeTTL, resendInterval time.Duration) *Store {
	return &Store{
		entries:        map[string]Entry{},
		codeTTL:        codeTTL,
		resendInterval: resendInterval,
	}
}

func (s *Store) Issue(email string) (Entry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	key := normalizeEmail(email)
	now := time.Now()
	if current, ok := s.entries[key]; ok {
		if now.Before(current.ResendAt) {
			return Entry{}, ErrCodeTooFrequent
		}
	}

	code, err := randomDigits(6)
	if err != nil {
		return Entry{}, err
	}
	entry := Entry{
		Code:      code,
		ExpiresAt: now.Add(s.codeTTL),
		ResendAt:  now.Add(s.resendInterval),
	}
	s.entries[key] = entry
	return entry, nil
}

func (s *Store) Verify(email, code string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	key := normalizeEmail(email)
	entry, ok := s.entries[key]
	if !ok || time.Now().After(entry.ExpiresAt) {
		delete(s.entries, key)
		return ErrCodeNotFound
	}
	if strings.TrimSpace(code) != entry.Code {
		return ErrCodeMismatch
	}
	return nil
}

func (s *Store) Consume(email string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.entries, normalizeEmail(email))
}

func normalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

func randomDigits(length int) (string, error) {
	var builder strings.Builder
	for i := 0; i < length; i++ {
		value, err := rand.Int(rand.Reader, big.NewInt(10))
		if err != nil {
			return "", err
		}
		builder.WriteByte(byte('0' + value.Int64()))
	}
	return builder.String(), nil
}
