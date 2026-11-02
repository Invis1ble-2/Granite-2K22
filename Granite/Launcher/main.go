// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.
package main

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()

	bg := &options.RGBA{R: 245, G: 243, B: 238, A: 255}
	winTheme := windows.Light
	if app.prefs.Dark {
		bg = &options.RGBA{R: 11, G: 13, B: 18, A: 255}
		winTheme = windows.Dark
	}

	err := wails.Run(&options.App{
		Title:                    "NBA 2K22 Granite Launcher",
		Width:                    1100,
		Height:                   720,
		MinWidth:                 980,
		MinHeight:                650,
		AssetServer:              &assetserver.Options{Assets: assets},
		BackgroundColour:         bg,
		EnableDefaultContextMenu: false,
		OnStartup:                app.startup,
		OnBeforeClose:            app.beforeClose,
		Bind: []interface{}{
			app,
		},
		Windows: &windows.Options{
			WebviewIsTransparent: false,
			WindowIsTranslucent:  false,
			Theme:                winTheme,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
