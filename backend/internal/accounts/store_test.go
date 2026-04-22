package accounts

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestNeedsImageQuotaRefreshWithoutQuotaMessage(t *testing.T) {
	account := PublicAccount{
		Status:         "正常",
		Quota:          5,
		LimitsProgress: nil,
	}

	if !NeedsImageQuotaRefresh(account, time.Now()) {
		t.Fatal("expected refresh to be required when image_gen quota message is missing")
	}
}

func TestNeedsImageQuotaRefreshByResetTime(t *testing.T) {
	now := time.Date(2026, 4, 22, 10, 0, 0, 0, time.UTC)

	freshAccount := PublicAccount{
		Status: "正常",
		Quota:  3,
		LimitsProgress: []map[string]any{
			{
				"feature_name": "image_gen",
				"remaining":    3,
				"reset_after":  now.Add(2 * time.Hour).Format(time.RFC3339),
			},
		},
	}
	if NeedsImageQuotaRefresh(freshAccount, now) {
		t.Fatal("expected refresh to be skipped before reset_after")
	}

	expiredAccount := PublicAccount{
		Status: "限流",
		Quota:  0,
		LimitsProgress: []map[string]any{
			{
				"feature_name": "image_gen",
				"remaining":    0,
				"reset_after":  now.Add(-1 * time.Minute).Format(time.RFC3339),
			},
		},
	}
	if !NeedsImageQuotaRefresh(expiredAccount, now) {
		t.Fatal("expected refresh to be required after reset_after")
	}
}

func TestImportAuthFilesSkipsDuplicateToken(t *testing.T) {
	rootDir := t.TempDir()
	authDir := filepath.Join(rootDir, "auths")
	syncDir := filepath.Join(rootDir, "sync")
	if err := os.MkdirAll(authDir, 0o755); err != nil {
		t.Fatalf("mkdir auth dir: %v", err)
	}
	if err := os.MkdirAll(syncDir, 0o755); err != nil {
		t.Fatalf("mkdir sync dir: %v", err)
	}

	store := &Store{
		authDir:      authDir,
		syncStateDir: syncDir,
		stateFile:    filepath.Join(rootDir, "state.json"),
		defaultQuota: 5,
		providerType: "codex",
		states:       map[string]RuntimeState{},
	}

	existingToken := "token-1"
	if err := writeJSONFile(filepath.Join(authDir, "existing.json"), map[string]any{
		"type":         "codex",
		"access_token": existingToken,
		"email":        "existing@example.com",
	}); err != nil {
		t.Fatalf("seed existing auth file: %v", err)
	}

	imported, importedTokens, skipped, failures, err := store.ImportAuthFiles([]ImportedAuthFile{
		{
			Name: "duplicate.json",
			Data: []byte(`{"type":"codex","access_token":"token-1","email":"dup@example.com"}`),
		},
		{
			Name: "fresh.json",
			Data: []byte(`{"type":"codex","access_token":"token-2","email":"fresh@example.com"}`),
		},
	})
	if err != nil {
		t.Fatalf("ImportAuthFiles returned error: %v", err)
	}
	if imported != 1 {
		t.Fatalf("expected imported=1, got %d", imported)
	}
	if len(importedTokens) != 1 || importedTokens[0] != "token-2" {
		t.Fatalf("expected imported token token-2, got %#v", importedTokens)
	}
	if len(skipped) != 1 {
		t.Fatalf("expected 1 skipped file, got %d", len(skipped))
	}
	if len(failures) != 0 {
		t.Fatalf("expected no failures, got %#v", failures)
	}

	auths, err := store.loadAuths()
	if err != nil {
		t.Fatalf("loadAuths returned error: %v", err)
	}
	if len(auths) != 2 {
		t.Fatalf("expected 2 auth files after import, got %d", len(auths))
	}
}

func TestImportAuthFilesKeepsNewerByIdentityAndType(t *testing.T) {
	rootDir := t.TempDir()
	authDir := filepath.Join(rootDir, "auths")
	syncDir := filepath.Join(rootDir, "sync")
	if err := os.MkdirAll(authDir, 0o755); err != nil {
		t.Fatalf("mkdir auth dir: %v", err)
	}
	if err := os.MkdirAll(syncDir, 0o755); err != nil {
		t.Fatalf("mkdir sync dir: %v", err)
	}

	store := &Store{
		authDir:      authDir,
		syncStateDir: syncDir,
		stateFile:    filepath.Join(rootDir, "state.json"),
		defaultQuota: 5,
		providerType: "codex",
		states:       map[string]RuntimeState{},
	}

	existingName := "existing.json"
	existingData := map[string]any{
		"type":         "codex",
		"access_token": "token-old",
		"account_id":   "acct-1",
		"email":        "user@example.com",
		"last_refresh": "2026-04-20T01:00:00+08:00",
	}
	if err := writeJSONFile(filepath.Join(authDir, existingName), existingData); err != nil {
		t.Fatalf("seed existing auth file: %v", err)
	}

	imported, importedTokens, skipped, failures, err := store.ImportAuthFiles([]ImportedAuthFile{
		{
			Name: "newer.json",
			Data: []byte(`{"type":"codex","access_token":"token-new","account_id":"acct-1","email":"user@example.com","last_refresh":"2026-04-21T01:00:00+08:00"}`),
		},
	})
	if err != nil {
		t.Fatalf("ImportAuthFiles returned error: %v", err)
	}
	if imported != 1 {
		t.Fatalf("expected imported=1, got %d", imported)
	}
	if len(importedTokens) != 1 || importedTokens[0] != "token-new" {
		t.Fatalf("expected imported token token-new, got %#v", importedTokens)
	}
	if len(skipped) != 0 {
		t.Fatalf("expected no skipped files, got %#v", skipped)
	}
	if len(failures) != 0 {
		t.Fatalf("expected no failures, got %#v", failures)
	}

	var stored map[string]any
	if err := readJSONFile(filepath.Join(authDir, existingName), &stored); err != nil {
		t.Fatalf("read overwritten auth file: %v", err)
	}
	if got := stringValue(stored["access_token"]); got != "token-new" {
		t.Fatalf("expected overwritten access_token token-new, got %s", got)
	}
}
