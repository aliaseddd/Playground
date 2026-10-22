#!/usr/bin/env python3
"""Short end-to-end test of the Anki-Connect v1 API.

Adds one card to a "Claude Test" deck, reads it back, lets you check it in
Anki, deletes the deck, then optionally syncs to AnkiWeb.
Anki Desktop must be open with your profile loaded.
"""
import itertools
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime

ENDPOINT = "http://127.0.0.1:8765/api/v1"
API_KEY = None  # Set this if you configured an apiKey for the add-on.
DECK = "Claude Test"
request_ids = itertools.count(1)


class RpcError(RuntimeError):
    pass


def call(method, **params):
    request_id = next(request_ids)
    body = {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}
    headers = {"Content-Type": "application/json"}
    if API_KEY is not None:
        headers["Authorization"] = f"Bearer {API_KEY}"
    request = urllib.request.Request(
        ENDPOINT, json.dumps(body).encode("utf-8"), headers=headers, method="POST"
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        reply = json.load(response)
    if reply.get("id") != request_id:
        raise RpcError("Unexpected response ID")
    if "error" in reply:
        error = reply["error"]
        kind = (error.get("data") or {}).get("type", error.get("code"))
        raise RpcError(f"{method} failed: {error.get('message')} [{kind}]")
    return reply["result"]


def wait_for_operation(handle, timeout=180):
    deadline = time.monotonic() + timeout
    told_user = False
    while True:
        operation = call("operations.get", operationId=handle["operationId"])
        state = operation["state"]
        if state == "succeeded":
            return operation["result"]
        if state in ("failed", "cancelled"):
            raise RpcError(f"{operation['method']} {state}: {operation['error'].get('message')}")
        if state == "waitingForUser" and not told_user:
            print("    Anki is waiting for you to make a choice in its window...")
            told_user = True
        if time.monotonic() >= deadline:
            raise TimeoutError("Still pending; check the Anki window.")
        time.sleep(0.5)


def ask(question):
    return input(f"{question} [Y/n] ").strip().lower() in ("", "y", "yes")


def step(number, text):
    print(f"\n[{number}] {text}")


def connect():
    step(1, "Connecting to Anki")
    try:
        info = call("api.describe")
    except urllib.error.HTTPError as e:
        hints = {
            401: "The add-on requires an API key. Set API_KEY at the top of this script.",
            403: "The add-on rejected this request's origin. Check its webCorsOriginList setting.",
            404: "The add-on is running but has no /api/v1. It is the older version.",
        }
        print(f"    FAILED: HTTP {e.code}. {hints.get(e.code, '')}")
        return False
    except urllib.error.URLError:
        print("    FAILED: Can't connect. Is Anki open with the add-on enabled?")
        return False
    except RpcError as e:
        if "unknown method" in str(e).lower() or "-32601" in str(e):
            print("    FAILED: The add-on doesn't recognize api.describe. It is likely the older version.")
        else:
            print(f"    FAILED: {e}")
        return False
    collection = call("collection.get")
    print(f"    OK: API v{info['apiMajor']}, Anki {info['ankiVersion']}, "
          f"profile \"{collection['profile']}\"")
    return True


def main():
    if not connect():
        return 1

    step(2, f'Creating deck "{DECK}"')
    if any(deck["name"] == DECK for deck in call("decks.list")):
        print(f'    STOPPED: A deck named "{DECK}" already exists. Rename it or change DECK '
              "in this script, so the cleanup step can't delete your own cards.")
        return 1
    deck = call("decks.create", name=DECK)
    print(f"    OK: deck id {deck['id']}")

    step(3, "Adding a test card")
    front = f"Test card from Claude ({datetime.now():%Y-%m-%d %H:%M:%S})"
    created = call(
        "notes.create",
        noteType={"name": "Basic"},
        deck={"name": DECK},
        fields={"Front": front, "Back": "If you can read this, the API works."},
        tags=["claude-test"],
    )
    print(f"    OK: note {created['noteId']}, {len(created['cardIds'])} card(s)")

    step(4, "Reading the card back")
    note = call("notes.get", id=created["noteId"])
    print(f"    OK: Front = {note['fields']['Front']!r}")

    input(f'\n    Look in Anki: the "{DECK}" deck should show 1 new card. '
          "Press Enter to continue...")

    step(5, "Cleaning up")
    if ask(f'    Delete the "{DECK}" deck and its card?'):
        result = call("decks.delete", decks=[{"name": DECK}], deleteCards=True)
        errors = [item["error"] for item in result["items"] if "error" in item]
        print(f"    FAILED: {errors}" if errors else "    OK: deleted")
    else:
        print("    Skipped. Delete the deck in Anki whenever you like.")

    step(6, "Syncing to AnkiWeb")
    if ask("    Sync now to test your AnkiWeb login?"):
        result = wait_for_operation(call("collection.sync"))
        print(f"    OK: collection synced={result['collectionComplete']}, "
              f"media synced={result['mediaComplete']}")
    else:
        print("    Skipped.")

    print("\nAll checks passed.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (RpcError, TimeoutError) as e:
        print(f"    FAILED: {e}")
        sys.exit(1)
