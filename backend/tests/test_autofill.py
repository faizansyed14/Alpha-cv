from app.ingestion import autofill as af


def test_notice_period_maps_only_clear_values():
    assert af.notice_period_option("Notice Period: 30 days") == "30 days"
    assert af.notice_period_option("Notice period - 1 month") == "30 days"
    assert af.notice_period_option("Notice period: 2 weeks") == "15 days"
    assert af.notice_period_option("Notice period: 2 months") == "60 days"
    assert af.notice_period_option("Notice period: 3 months") == "More than 60 days"
    assert af.notice_period_option("Notice period: Immediate") == "Immediately"
    assert af.notice_period_option("Notice period: negotiable") is None      # not certain, so left blank
    assert af.notice_period_option("Notice period: 20 days") is None         # no matching option
    assert af.notice_period_option("I will give notice of 30 days") is None   # no label


def test_nationality_needs_a_label():
    assert af.nationality_raw("Name: A\nNationality: Indian\nPhone: 1") == "Indian"
    assert af.nationality_raw("Born in India and living in Dubai") is None
    assert af.nationality_raw("Nationality: 12345") is None


def test_location_must_match_the_city_list_exactly():
    assert af.location_label("Current Location: Dubai, UAE") == "Dubai, United Arab Emirates"
    assert af.location_label("Location: Dubaii") is None
    assert af.location_label("I worked in Dubai") is None


def test_only_certain_values_are_offered():
    parsed = {"raw_text": "Priya Sharma\nNationality: Indian\nNotice period: 30 days",
              "extracted_pii": {"email": ["priya.sharma@gmail.com"], "phone": ["+971 50 123 4567"]}}
    out = af.build_autofill(parsed, {"name": "Priya Sharma", "years_of_experience": 7})
    assert out["fields"] == {"email": "priya.sharma@gmail.com", "phone": "+971 50 123 4567", "name": "Priya Sharma",
                             "yearsOfExperience": "7", "noticePeriod": "30 days", "nationality": "Indian"}
    # no AI answer, no contacts, a heading instead of a name: nothing invented
    out = af.build_autofill({"raw_text": "Curriculum Vitae\nProfessional summary", "extracted_pii": {}}, None)
    assert out["fields"] == {}
    out = af.build_autofill({"raw_text": "x", "extracted_pii": {"email": [], "phone": ["12"]}}, {"years_of_experience": 120})
    assert out["fields"] == {}


def test_cache_roundtrip_is_keyed_by_the_cv_text(monkeypatch):
    store = {}

    class FakeRedis:
        def get(self, key, namespace="default"):
            return store.get((namespace, key))

        def set(self, key, value, ttl_seconds=None, namespace="default"):
            store[(namespace, key)] = value
            return True

    monkeypatch.setattr("app.providers.cache.redis.get_redis_cache", lambda: FakeRedis())
    assert af.cached_standardized("cv text") is None
    af.park_standardized("cv text", {"name": "A"})
    assert af.cached_standardized("cv text") == {"name": "A"}
    assert af.cached_standardized("other text") is None


def test_a_work_history_date_range_is_never_a_phone():
    """Seen on a real CV: "06/2018 - 08/2019" was offered as the phone number "2018 - 08/2019"."""
    from app.ingestion.contact import extract_contacts

    cv = ("Mohamed Yahya\nCertified ScrumMaster | Technical Project Manager\nWORK EXPERIENCE\nSolutions Lead/Architect\n"
          "Automation Anywhere\n11/2019 - 04/2023, Dubai, United Arab Emirates\nSenior Application Developer Consultant\n"
          "Microexcel\n06/2018 - 08/2019, Dubai, United Arab Emirates\nSoftware Solutions Consultant\nCrossOver\n"
          "09/2017 - 06/2018, 401 Congress Ave Suite 2650, Austin, TX 78701\n09/2015 - 08/2017\n07/2014 - 09/2015\n")
    assert extract_contacts(cv)["phones"] == []
    out = af.build_autofill({"raw_text": cv, "extracted_pii": {"email": [], "phone": ["2018 - 08/2019"]}}, {"years_of_experience": 15})
    assert "phone" not in out["fields"] and out["fields"]["yearsOfExperience"] == "15"


def test_real_phones_are_kept_only_with_evidence():
    assert af.phone_is_certain("Call +971 50 123 4567 now", "+971 50 123 4567")
    assert af.phone_is_certain("Mobile: 050 123 4567", "050 123 4567")
    assert not af.phone_is_certain("ref 0501234567 in the text", "0501234567")      # a bare run of digits
    assert not af.phone_is_certain("x", "06/2018 - 08/2019")
