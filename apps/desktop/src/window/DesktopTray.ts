import { DEFAULT_CLIENT_SETTINGS, type ClientSettings } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import * as Electron from "electron";

import * as DesktopAssets from "../app/DesktopAssets.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import { makeComponentLogger } from "../app/DesktopObservability.ts";
import * as DesktopState from "../app/DesktopState.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as DesktopClientSettings from "../settings/DesktopClientSettings.ts";
import * as DesktopWindow from "./DesktopWindow.ts";

/**
 * The "Keep running when closed" setting on Windows and Linux: while it is on,
 * closing the last window leaves the app running and a tray icon reopens or
 * quits it. macOS already keeps running from the Dock, so it never gets a tray.
 */
export class DesktopTray extends Context.Service<
  DesktopTray,
  {
    /** Applies the stored setting at startup. */
    readonly initialize: Effect.Effect<void>;
    /** Applies the setting whenever client settings change. */
    readonly configure: (settings: ClientSettings) => Effect.Effect<void>;
  }
>()("@t3tools/desktop/window/DesktopTray") {}

const { logWarning: logTrayWarning, logError: logTrayError } = makeComponentLogger("desktop-tray");

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const state = yield* DesktopState.DesktopState;
  const assets = yield* DesktopAssets.DesktopAssets;
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const electronApp = yield* ElectronApp.ElectronApp;
  const clientSettings = yield* DesktopClientSettings.DesktopClientSettings;
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  let tray: Electron.Tray | null = null;

  const open = () =>
    void runPromise(
      desktopWindow.activate.pipe(
        Effect.catchCause((cause) => logTrayError("failed to open window from tray", { cause })),
      ),
    );
  const quit = () => void runPromise(electronApp.quit);

  const configure = Effect.fn("desktop.tray.configure")(function* (settings: ClientSettings) {
    const enabled = environment.platform !== "darwin" && settings.keepRunningWhenClosed;
    yield* Ref.set(state.keepRunningWhenClosed, enabled);
    if (enabled === (tray !== null)) return;
    if (!enabled) {
      tray?.destroy();
      tray = null;
      return;
    }
    // Relaunching the app still brings the window back when there is no icon,
    // or on desktops such as stock GNOME that hide tray icons.
    const icon = (yield* assets.iconPaths)[environment.platform === "win32" ? "ico" : "png"];
    if (Option.isNone(icon)) {
      yield* logTrayWarning("no tray icon asset; keeping running without a tray");
      return;
    }
    tray = new Electron.Tray(icon.value);
    tray.setToolTip(environment.displayName);
    tray.setContextMenu(
      Electron.Menu.buildFromTemplate([
        { label: `Open ${environment.displayName}`, click: open },
        { type: "separator" },
        { label: "Quit", click: quit },
      ]),
    );
    tray.on("click", open);
  });

  yield* Effect.addFinalizer(() => Effect.sync(() => tray?.destroy()));
  const initialize = clientSettings.get.pipe(
    Effect.flatMap((stored) => configure(Option.getOrElse(stored, () => DEFAULT_CLIENT_SETTINGS))),
    Effect.catchCause((cause) => logTrayError("failed to read client settings", { cause })),
  );

  return DesktopTray.of({ initialize, configure });
});

export const layer = Layer.effect(DesktopTray, make);
