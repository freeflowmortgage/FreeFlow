#!/usr/bin/env python3
"""Send the LoanBeam comparison email to one recipient through Purelymail SMTP.

One recipient per run, by design. freeflowmortgage.com publishes
``v=DMARC1; p=reject``, so a message carrying a From address on that domain is
rejected outright unless it is signed by Purelymail -- sending this HTML from
any other provider will bounce rather than land in spam.

The password is prompted for and never taken from argv, which other processes on
the host can read, nor written to shell history by an ``export``:

    export PURELYMAIL_USER='nathan@freeflowmortgage.com'

    python3 send.py --to uw.manager@lender.com --first-name Dana \
        --sender-name 'Nathan Jenson' --sender-title 'Founder'

Use an app password rather than the account login, so revoking it does not
change the password on the mailbox itself. ``PURELYMAIL_PASSWORD`` is still
honoured when set, for an automated run with no terminal attached.

``--draft`` files the message in the mailbox over IMAP instead of sending it.
Purelymail's webmail composes in rich text with no way to paste HTML source, so
a draft is the only route to this template from a phone: seed one from a
desktop, then open Drafts in webmail, set the recipient, and send.
"""

from __future__ import annotations

import argparse
import imaplib
import os
import re
import smtplib
import ssl
import sys
import time
from email.headerregistry import Address
from email.message import EmailMessage
from getpass import getpass
from pathlib import Path

HERE = Path(__file__).resolve().parent
SMTP_HOST = 'smtp.purelymail.com'
SMTP_PORT = 465
IMAP_HOST = 'imap.purelymail.com'
IMAP_PORT = 993
LIST_LINE = re.compile(rb'\((?P<flags>[^)]*)\) "(?P<delimiter>[^"]*)" (?P<name>.+)')


def load_text() -> tuple[str, str]:
    """Return (subject, body) from email.txt, whose first two lines are headers."""
    lines = (HERE / 'email.txt').read_text(encoding='utf-8').splitlines()
    if not lines or not lines[0].startswith('Subject:'):
        raise SystemExit('email.txt must open with a Subject: line')
    subject = lines[0].removeprefix('Subject:').strip()
    rest = lines[1:]
    if rest and rest[0].startswith('Preheader:'):
        rest = rest[1:]
    return subject, '\n'.join(rest).lstrip('\n')


def fill(template: str, values: dict[str, str]) -> str:
    for key, value in values.items():
        template = template.replace('{{%s}}' % key, value)
    leftover = [token for token in ('{{', '}}') if token in template]
    if leftover:
        start = template.index('{{')
        raise SystemExit(f'unsubstituted placeholder near: {template[start:start + 40]!r}')
    return template


def build(args: argparse.Namespace, sender: str) -> EmailMessage:
    subject, text = load_text()
    html = (HERE / 'email.html').read_text(encoding='utf-8')
    unsubscribe = f'mailto:{sender}?subject=unsubscribe'
    values = {
        'first_name': args.first_name,
        'sender_name': args.sender_name,
        'sender_title': args.sender_title,
        'unsubscribe_link': unsubscribe,
    }
    html_values = {
        **values,
        'unsubscribe_link': f'<a href="{unsubscribe}" style="color:#7b8794;">this link</a>',
    }

    message = EmailMessage()
    message['Subject'] = subject
    message['From'] = Address(display_name=args.sender_name, addr_spec=sender)
    message['To'] = args.to
    message['Reply-To'] = sender
    # One-click list management keeps a cold send out of the bulk folder.
    message['List-Unsubscribe'] = f'<mailto:{sender}?subject=unsubscribe>'
    message.set_content(fill(text, values))
    message.add_alternative(fill(html, html_values), subtype='html')
    return message


def drafts_folder(listing: list[bytes]) -> str:
    """Return the mailbox the server flags \\Drafts, falling back to 'Drafts'.

    Only the flag is trustworthy. Purelymail answers in English today, but a
    server is free to localise the name, and the delimiter differs between
    servers too, so the name is read back out of the LIST line rather than
    assumed.
    """
    for line in listing or []:
        parsed = LIST_LINE.match(line or b'')
        if not parsed:
            continue
        # Compared as whole tokens: a substring test also matches \DraftsArchive.
        flags = parsed.group('flags').decode('latin-1').split()
        if any(flag.lower() == r'\drafts' for flag in flags):
            return parsed.group('name').decode().strip().strip('"')
    return 'Drafts'


def file_draft(message: EmailMessage, sender: str, password: str) -> str:
    imap = imaplib.IMAP4_SSL(IMAP_HOST, IMAP_PORT, ssl_context=ssl.create_default_context())
    try:
        imap.login(sender, password)
        folder = drafts_folder(imap.list()[1])
        status, detail = imap.append(
            f'"{folder}"', r'(\Draft)', imaplib.Time2Internaldate(time.time()), message.as_bytes()
        )
        if status != 'OK':
            raise SystemExit(f'{IMAP_HOST} refused the draft: {detail}')
        return folder
    finally:
        try:
            imap.logout()
        except OSError:
            pass


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--to', required=True)
    parser.add_argument('--first-name', required=True)
    parser.add_argument('--sender-name', required=True)
    parser.add_argument('--sender-title', required=True)
    parser.add_argument('--dry-run', action='store_true', help='print the message instead of sending')
    parser.add_argument('--draft', action='store_true', help='file the message in Drafts instead of sending')
    args = parser.parse_args()

    sender = os.environ.get('PURELYMAIL_USER', '')
    if not sender:
        raise SystemExit('set PURELYMAIL_USER to the full address you send from')
    message = build(args, sender)

    if args.dry_run:
        sys.stdout.write(message.as_string())
        return 0

    password = os.environ.get('PURELYMAIL_PASSWORD') or getpass(f'App password for {sender}: ')
    if not password:
        raise SystemExit('an app password is required to send')

    if args.draft:
        try:
            folder = file_draft(message, sender, password)
        except imaplib.IMAP4.error as error:
            raise SystemExit(
                f'{IMAP_HOST} rejected the login or the draft for {sender}: {error}'
            ) from None
        except OSError as error:
            raise SystemExit(f'{IMAP_HOST} was unreachable: {error}') from None
        print(f'filed a draft in {folder}; open it in webmail, set the recipient, and send')
        return 0

    try:
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, context=ssl.create_default_context()) as smtp:
            smtp.login(sender, password)
            smtp.send_message(message)
    except smtplib.SMTPAuthenticationError:
        raise SystemExit(
            f'{SMTP_HOST} rejected the login for {sender}. Check that the address is a real '
            'mailbox and that the password is a current app password.'
        ) from None
    except (smtplib.SMTPException, OSError) as error:
        raise SystemExit(f'{SMTP_HOST} refused the message: {error}') from None
    print(f'sent to {args.to}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
