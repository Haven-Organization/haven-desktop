/*
Copyright 2026 Element Creations Ltd.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React from "react";
import { render } from "jest-matrix-react";
import { RovingAction, type RovingTabIndexProviderProps } from "@element-hq/web-shared-components";

import * as KeyBindingsManagerModule from "../../../src/KeyBindingsManager";
import { KeyBindingAction } from "../../../src/accessibility/KeyboardShortcuts";
import { RovingTabIndexProvider } from "../../../src/accessibility/RovingTabIndex";

jest.mock("@element-hq/web-shared-components", () => {
    const actual = jest.requireActual("@element-hq/web-shared-components");
    const mockSharedRovingTabIndexProvider = jest.fn(({ children }: RovingTabIndexProviderProps) => {
        return <>{children({ onDragEndHandler: jest.fn(), onKeyDownHandler: jest.fn() })}</>;
    });

    return {
        __mockSharedRovingTabIndexProvider: mockSharedRovingTabIndexProvider,
        ...actual,
        RovingTabIndexProvider: mockSharedRovingTabIndexProvider,
    };
});

const getMockSharedRovingTabIndexProvider = (): jest.Mock => {
    return jest.requireMock("@element-hq/web-shared-components").__mockSharedRovingTabIndexProvider as jest.Mock;
};

const getInjectedGetAction = (): NonNullable<RovingTabIndexProviderProps["getAction"]> => {
    const mockSharedRovingTabIndexProvider = getMockSharedRovingTabIndexProvider();
    expect(mockSharedRovingTabIndexProvider).toHaveBeenCalled();
    const getAction = (mockSharedRovingTabIndexProvider.mock.calls.at(-1)![0] as RovingTabIndexProviderProps).getAction;
    expect(getAction).toBeDefined();
    return getAction!;
};

describe("RovingTabIndex adapter", () => {
    beforeEach(() => {
        const mockSharedRovingTabIndexProvider = getMockSharedRovingTabIndexProvider();
        mockSharedRovingTabIndexProvider.mockClear();
        jest.restoreAllMocks();
    });

    it.each([
        [KeyBindingAction.ArrowDown, RovingAction.ArrowDown],
        [KeyBindingAction.ArrowUp, RovingAction.ArrowUp],
        [KeyBindingAction.ArrowRight, RovingAction.ArrowRight],
        [KeyBindingAction.ArrowLeft, RovingAction.ArrowLeft],
        [KeyBindingAction.Home, RovingAction.Home],
        [KeyBindingAction.End, RovingAction.End],
        [KeyBindingAction.Tab, RovingAction.Tab],
    ])("maps %s to %s", (accessibilityAction, expectedRovingAction) => {
        const manager = new KeyBindingsManagerModule.KeyBindingsManager();
        jest.spyOn(KeyBindingsManagerModule, "getKeyBindingsManager").mockReturnValue(manager);
        jest.spyOn(manager, "getAccessibilityAction").mockReturnValue(accessibilityAction);

        render(<RovingTabIndexProvider>{() => null}</RovingTabIndexProvider>);

        const getAction = getInjectedGetAction();
        expect(
            getAction({ key: "irrelevant", target: document.createElement("div") } as unknown as React.KeyboardEvent),
        ).toBe(expectedRovingAction);
    });

    it("returns undefined when there is no matching accessibility action", () => {
        const manager = new KeyBindingsManagerModule.KeyBindingsManager();
        jest.spyOn(KeyBindingsManagerModule, "getKeyBindingsManager").mockReturnValue(manager);
        jest.spyOn(manager, "getAccessibilityAction").mockReturnValue(undefined);

        render(<RovingTabIndexProvider>{() => null}</RovingTabIndexProvider>);

        const getAction = getInjectedGetAction();
        expect(
            getAction({ key: "x", target: document.createElement("div") } as unknown as React.KeyboardEvent),
        ).toBeUndefined();
    });

    describe("H/J/K/L vim-style navigation (Haven)", () => {
        function mkEvent(key: string, target: HTMLElement, extra: Partial<React.KeyboardEvent> = {}): React.KeyboardEvent {
            return {
                key,
                ctrlKey: false,
                altKey: false,
                shiftKey: false,
                metaKey: false,
                target,
                ...extra,
            } as React.KeyboardEvent;
        }

        beforeEach(() => {
            const manager = new KeyBindingsManagerModule.KeyBindingsManager();
            jest.spyOn(KeyBindingsManagerModule, "getKeyBindingsManager").mockReturnValue(manager);
            // no real KeyBindingAction matches, so getWebRovingAction falls through to h/j/k/l
            jest.spyOn(manager, "getAccessibilityAction").mockReturnValue(undefined);
        });

        it.each([
            ["j", RovingAction.ArrowDown],
            ["k", RovingAction.ArrowUp],
            ["h", RovingAction.ArrowLeft],
            ["l", RovingAction.ArrowRight],
        ])("maps plain '%s' to %s", (key, expectedRovingAction) => {
            render(<RovingTabIndexProvider>{() => null}</RovingTabIndexProvider>);
            const getAction = getInjectedGetAction();

            const target = document.createElement("div");
            expect(getAction(mkEvent(key, target))).toBe(expectedRovingAction);
        });

        it("does not navigate when a modifier is held alongside j/k/h/l", () => {
            render(<RovingTabIndexProvider>{() => null}</RovingTabIndexProvider>);
            const getAction = getInjectedGetAction();

            const target = document.createElement("div");
            expect(getAction(mkEvent("j", target, { ctrlKey: true }))).toBeUndefined();
            expect(getAction(mkEvent("k", target, { altKey: true }))).toBeUndefined();
            expect(getAction(mkEvent("h", target, { shiftKey: true }))).toBeUndefined();
            expect(getAction(mkEvent("l", target, { metaKey: true }))).toBeUndefined();
        });

        it("does not navigate when the target is a real text input", () => {
            render(<RovingTabIndexProvider>{() => null}</RovingTabIndexProvider>);
            const getAction = getInjectedGetAction();

            const input = document.createElement("input");
            expect(getAction(mkEvent("j", input))).toBeUndefined();
        });
    });

    it("forwards provider props to shared-components", () => {
        const onKeyDown = jest.fn();

        render(
            <RovingTabIndexProvider handleHomeEnd handleLoop handleUpDown onKeyDown={onKeyDown} scrollIntoView>
                {() => null}
            </RovingTabIndexProvider>,
        );

        const mockSharedRovingTabIndexProvider = getMockSharedRovingTabIndexProvider();
        const props = mockSharedRovingTabIndexProvider.mock.calls.at(-1)![0] as RovingTabIndexProviderProps;
        expect(props.handleHomeEnd).toBe(true);
        expect(props.handleLoop).toBe(true);
        expect(props.handleUpDown).toBe(true);
        expect(props.onKeyDown).toBe(onKeyDown);
        expect(props.scrollIntoView).toBe(true);
        expect(props.getAction).toEqual(expect.any(Function));
    });
});
