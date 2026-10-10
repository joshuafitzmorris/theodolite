# guards: dict.update, settings.update, cache.delete and request.session.save are not sites
def lookalikes(d, settings, cache, request, params, session):
    d.update({"a": 1})
    settings.update(params)
    cache.delete("k")
    request.session.save()
    session.save()
    params.pop("q")
