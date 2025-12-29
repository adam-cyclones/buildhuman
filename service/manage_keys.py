#!/usr/bin/env python3
"""
API Key Management CLI Tool

This script helps manage moderator API keys for the BuildHuman asset service.
The script itself is safe to commit - it contains no secrets.

WARNING: Never commit the database file (buildhuman.db) or share API keys!
"""

import sqlite3
import secrets
import sys
from datetime import datetime
from pathlib import Path

# Database path - relative to this script
DB_PATH = Path(__file__).parent / "assets.db"


def create_key(name: str, role: str = "moderator"):
    """Create a new API key"""
    # Generate a cryptographically secure random key
    api_key = secrets.token_urlsafe(32)

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    try:
        c.execute("""
            INSERT INTO api_keys (key, name, role, created_at, last_used, active)
            VALUES (?, ?, ?, ?, NULL, 1)
        """, (api_key, name, role, datetime.utcnow().isoformat()))

        conn.commit()

        print(f"\n✓ API Key created successfully!")
        print(f"  Name: {name}")
        print(f"  Role: {role}")
        print(f"  Key:  {api_key}")
        print("\n⚠️  IMPORTANT: Save this key securely - it won't be shown again!")
        print("   Share it privately with the moderator (e.g., via encrypted message)")

    except sqlite3.IntegrityError as e:
        print(f"\n✗ Error: {e}")
        print("  (Key may already exist or database schema issue)")
    finally:
        conn.close()


def list_keys():
    """List all API keys (without showing the actual keys)"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    c.execute("""
        SELECT name, role, created_at, last_used, active
        FROM api_keys
        ORDER BY created_at DESC
    """)

    rows = c.fetchall()

    if not rows:
        print("\n📋 No API keys found")
        conn.close()
        return

    print("\n📋 API Keys:")
    print("=" * 90)
    print(f"{'Name':<25} {'Role':<12} {'Status':<12} {'Created':<20} {'Last Used':<20}")
    print("-" * 90)

    for row in rows:
        name, role, created, last_used, active = row
        status = "✓ Active" if active else "✗ Revoked"
        created_date = created[:19] if created else "N/A"
        last_used_date = last_used[:19] if last_used else "Never"
        print(f"{name:<25} {role:<12} {status:<12} {created_date:<20} {last_used_date:<20}")

    print("=" * 90)
    print(f"\nTotal: {len(rows)} keys ({sum(1 for r in rows if r[4])} active)")

    conn.close()


def revoke_key(name: str):
    """Revoke an API key by name"""
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    c.execute("UPDATE api_keys SET active = 0 WHERE name = ? AND active = 1", (name,))

    if c.rowcount > 0:
        print(f"\n✓ Revoked API key for: {name}")
    else:
        print(f"\n✗ No active key found for: {name}")

    conn.commit()
    conn.close()


def show_help():
    """Show usage help"""
    print("""
BuildHuman API Key Manager
==========================

Usage:
  python manage_keys.py create <name> [role]  - Create new API key
  python manage_keys.py list                  - List all keys (keys hidden)
  python manage_keys.py revoke <name>         - Revoke a key

Arguments:
  name  - Moderator name (e.g., "Alice", "Bob", "Your Name")
  role  - Either "admin" or "moderator" (default: moderator)

Examples:
  python manage_keys.py create "Alice" admin      # Create admin key
  python manage_keys.py create "Bob" moderator    # Create moderator key
  python manage_keys.py create "Charlie"          # Create moderator key (default)
  python manage_keys.py list                      # Show all keys
  python manage_keys.py revoke "Bob"              # Revoke Bob's key

Roles:
  admin     - Can create other API keys (via API)
  moderator - Can review and approve/reject submissions

Security Notes:
  ⚠️  Never commit buildhuman.db to git (already in .gitignore)
  ⚠️  Share API keys privately (encrypted chat, password manager, etc.)
  ⚠️  Revoke keys immediately if compromised
  ⚠️  Rotate keys periodically for security
""")


if __name__ == "__main__":
    # Check if database exists
    if not DB_PATH.exists():
        print(f"\n✗ Error: Database not found at {DB_PATH}")
        print("  Make sure you're running this from the service/ directory")
        print("  and that the service has been initialized (run main.py first)")
        print("  The database will be created automatically when you start the service.")
        sys.exit(1)

    # Parse command
    if len(sys.argv) < 2:
        show_help()
        sys.exit(1)

    command = sys.argv[1].lower()

    if command == "create":
        if len(sys.argv) < 3:
            print("\n✗ Error: Please specify a name")
            print("  Usage: python manage_keys.py create <name> [role]")
            sys.exit(1)

        name = sys.argv[2]
        role = sys.argv[3].lower() if len(sys.argv) > 3 else "moderator"

        if role not in ["admin", "moderator"]:
            print(f"\n✗ Error: Invalid role '{role}'")
            print("  Role must be either 'admin' or 'moderator'")
            sys.exit(1)

        create_key(name, role)

    elif command == "list":
        list_keys()

    elif command == "revoke":
        if len(sys.argv) < 3:
            print("\n✗ Error: Please specify a name to revoke")
            print("  Usage: python manage_keys.py revoke <name>")
            sys.exit(1)

        name = sys.argv[2]
        revoke_key(name)

    elif command in ["help", "--help", "-h"]:
        show_help()

    else:
        print(f"\n✗ Unknown command: {command}")
        show_help()
        sys.exit(1)
