# guards: match entries find calls and URLs, and a definition of the matched name is not a write
import resend


def notify(to):
    send_email(to)  # expect: effect.email high
    resend.emails.send({"to": to})  # expect: effect.email high
    base = "https://api.stripe.com/v1"  # expect: external.stripe high
    return base


def send_email(to):
    return to


async def send_email_later(to):
    return to
