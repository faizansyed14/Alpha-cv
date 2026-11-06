from app.services import locations_service as ls


def test_cities_and_aliases_roll_up_to_their_country():
    assert ls.country_of("Dubai, UAE") == "United Arab Emirates"
    assert ls.country_of("Dubai") == "United Arab Emirates"
    assert ls.country_of("Abu Dhabi, United Arab Emirates") == "United Arab Emirates"
    assert ls.country_of("London, UK") == "United Kingdom"
    assert ls.country_of("India") == "India"
    assert ls.country_of("Atlantis") == "" and ls.country_of("") == ""


def test_grouping_sums_counts_and_keeps_the_raw_members():
    g = ls.group_by_country([
        {"value": "Dubai, UAE", "count": 3}, {"value": "Dubai", "count": 2}, {"value": "Delhi, India", "count": 4},
        {"value": "Atlantis", "count": 9},
    ])
    assert [(x["value"], x["count"]) for x in g] == [("United Arab Emirates", 5), ("India", 4)]
    assert g[0]["members"] == ["Dubai, UAE", "Dubai"]          # the search looks for these stored values
