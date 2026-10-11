import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

export class DesktopState extends Context.Service<
  DesktopState,
  {
    readonly backendReady: Ref.Ref<boolean>;
    readonly quitting: Ref.Ref<boolean>;
    // Windows and Linux: closing the last window leaves the app running. Kept
    // in sync with the client setting by DesktopTray.
    readonly keepRunningWhenClosed: Ref.Ref<boolean>;
  }
>()("@t3tools/desktop/app/DesktopState") {}

const make = Effect.all({
  backendReady: Ref.make(false),
  quitting: Ref.make(false),
  keepRunningWhenClosed: Ref.make(false),
});

export const layer = Layer.effect(DesktopState, make);
