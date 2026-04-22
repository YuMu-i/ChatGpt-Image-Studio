package main

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"chatgpt2api/api"
	"chatgpt2api/internal/accounts"
	"chatgpt2api/internal/cliproxy"
	"chatgpt2api/internal/config"
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	cfg := config.New("")
	if err := cfg.Load(); err != nil {
		logger.Error("load config", slog.Any("error", err))
		os.Exit(1)
	}

	store, err := accounts.NewStore(cfg)
	if err != nil {
		logger.Error("init account store", slog.Any("error", err))
		os.Exit(1)
	}

	syncTimeout := time.Duration(max(10, cfg.Sync.RequestTimeout)) * time.Second
	syncClient := cliproxy.New(cfg.Sync.BaseURL, cfg.Sync.ManagementKey, cfg.Sync.ProviderType, syncTimeout)

	host := envString("SERVER_HOST", cfg.Server.Host)
	port := envInt("SERVER_PORT", cfg.Server.Port)
	addr := net.JoinHostPort(host, strconv.Itoa(port))

	server := &http.Server{
		Addr:              addr,
		Handler:           api.SetupRouter(cfg, store, syncClient),
		ReadHeaderTimeout: 5 * time.Second,
	}

	logger.Info("chatgpt2api-studio listening", slog.String("addr", addr))

	errCh := make(chan error, 1)
	go func() {
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	select {
	case err := <-errCh:
		logger.Error("server error", slog.Any("error", err))
		os.Exit(1)
	case <-ctx.Done():
		logger.Info("shutdown signal received")
	}

	shutCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = server.Shutdown(shutCtx)
	logger.Info("server stopped")
}

func envString(key, fallback string) string {
	if value := os.Getenv(key); strings.TrimSpace(value) != "" {
		return value
	}
	return fallback
}

func envInt(key string, fallback int) int {
	if value := os.Getenv(key); value != "" {
		if parsed, err := strconv.Atoi(value); err == nil {
			return parsed
		}
	}
	return fallback
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
