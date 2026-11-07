// Haven: the blockquote style a message is sent with - the user's own choice wins over the host's.
import { describe, it, expect, vi, beforeEach } from "vitest";

import SdkConfig from "../../../element-web/apps/web/src/SdkConfig";
import SettingsStore from "../../../element-web/apps/web/src/settings/SettingsStore";
import { getBlockquoteStyle, getHostBlockquoteStyle } from "./config";

function setup(host: string | undefined, own: string | null): void {
    vi.spyOn(SdkConfig, "get").mockReturnValue({ haven: { blockquote_style: host } } as never);
    vi.spyOn(SettingsStore, "getValue").mockImplementation(((name: string) =>
        name === "Haven.blockquoteStyle" ? own : undefined) as never);
}

describe("getBlockquoteStyle", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it("uses the host's style when the user hasn't picked one", () => {
        setup("greentext", null);
        expect(getBlockquoteStyle()).toBe("greentext");
        setup(undefined, null);
        expect(getBlockquoteStyle()).toBe("stock");
    });

    it("uses the user's own style over the host's", () => {
        setup("greentext", "stock");
        expect(getBlockquoteStyle()).toBe("stock");
        setup("stock", "greentext");
        expect(getBlockquoteStyle()).toBe("greentext");
    });

    it("ignores a stored value it doesn't know", () => {
        setup("greentext", "purple");
        expect(getBlockquoteStyle()).toBe("greentext");
    });

    it("reports the host's style on its own", () => {
        setup("greentext", "stock");
        expect(getHostBlockquoteStyle()).toBe("greentext");
        setup("bogus", null);
        expect(getHostBlockquoteStyle()).toBe("stock");
    });
});
