# guards: requests and httpx writes, sessions and clients with a base URL, and a dynamic URL as "?"
import httpx
import requests

s = requests.Session()


def http(url):
    requests.post("https://api.stripe.com/v1/charges", json={})  # expect: external.stripe high
    httpx.put("https://api.stripe.com/v1/x")  # expect: external.stripe high
    requests.patch("https://api.stripe.com/v1/y")  # expect: external.stripe high
    requests.delete("https://api.stripe.com/v1/z")  # expect: external.stripe high
    s.post("https://api.stripe.com/v1/s")  # expect: external.stripe high
    requests.request("POST", "https://api.stripe.com/v1/r")  # expect: external.stripe high
    with httpx.Client(base_url="https://api.stripe.com") as c:  # expect: external.stripe high
        c.post("/charges")  # expect: external.stripe high
    requests.post("https://hooks.example.org/in")  # expect: unmapped high
    requests.post(url)  # expect: ? medium
