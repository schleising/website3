from __future__ import annotations

import unittest

from website.utils.nginx_errors import (
    SITE_ORIGIN,
    nginx_5xx_page_context,
    original_request_url,
    parse_nginx_status,
    safe_original_host,
    service_label,
)


class NginxErrorHelperTests(unittest.TestCase):
    def test_parse_nginx_status_accepts_5xx(self) -> None:
        self.assertEqual(parse_nginx_status("503"), 503)
        self.assertEqual(parse_nginx_status(" 504 "), 504)

    def test_parse_nginx_status_defaults_invalid_values(self) -> None:
        self.assertEqual(parse_nginx_status(None), 502)
        self.assertEqual(parse_nginx_status("abc"), 502)
        self.assertEqual(parse_nginx_status("404"), 502)
        self.assertEqual(parse_nginx_status("200"), 502)

    def test_safe_original_host_allows_site_hosts(self) -> None:
        self.assertEqual(
            safe_original_host("Overseerr.schleising.net:8443"),
            "overseerr.schleising.net",
        )
        self.assertEqual(safe_original_host("schleising.net"), "schleising.net")

    def test_safe_original_host_rejects_other_values(self) -> None:
        self.assertEqual(safe_original_host("evil.example"), "")
        self.assertEqual(safe_original_host("overseerr.schleising.net/stolen"), "")
        self.assertEqual(safe_original_host(None), "")

    def test_original_request_url_keeps_path_and_query(self) -> None:
        self.assertEqual(
            original_request_url("tautulli.schleising.net", "/activity?page=2"),
            "https://tautulli.schleising.net/activity?page=2",
        )
        self.assertEqual(original_request_url("", "/activity"), "")
        self.assertEqual(
            original_request_url("overseerr.schleising.net", "relative"),
            "https://overseerr.schleising.net/",
        )

    def test_rebuild_variant_names_overseerr(self) -> None:
        context = nginx_5xx_page_context(
            raw_status="502",
            raw_host="overseerr.schleising.net",
            raw_uri="/",
            raw_variant="rebuild",
        )

        self.assertEqual(context["error_code"], 502)
        self.assertEqual(context["error_heading"], "Storage Rebuild")
        self.assertEqual(context["error_title"], "Overseerr is temporarily offline.")
        self.assertIn("NAS storage pool is rebuilt", context["error_message"])
        self.assertEqual(context["retry_url"], "https://overseerr.schleising.net/")
        self.assertEqual(context["site_origin"], SITE_ORIGIN)
        self.assertEqual(context["login_next"], "https://overseerr.schleising.net/")

    def test_rebuild_variant_names_tautulli(self) -> None:
        context = nginx_5xx_page_context(
            raw_status="502",
            raw_host="tautulli.schleising.net",
            raw_uri="/home",
            raw_variant="rebuild",
        )

        self.assertEqual(context["error_title"], "Tautulli is temporarily offline.")
        self.assertEqual(
            context["retry_url"],
            "https://tautulli.schleising.net/home",
        )

    def test_generic_502_names_known_service(self) -> None:
        context = nginx_5xx_page_context(
            raw_status="502",
            raw_host="overseerr.schleising.net",
            raw_uri="/",
            raw_variant="",
        )

        self.assertEqual(context["error_heading"], "Bad Gateway")
        self.assertEqual(context["error_title"], "Overseerr could not be reached.")

    def test_rebuild_variant_names_nas_apps(self) -> None:
        for host, name in (
            ("sonarr.schleising.net", "Sonarr"),
            ("radarr.schleising.net", "Radarr"),
            ("prowlarr.schleising.net", "Prowlarr"),
            ("plex.schleising.net", "Plex"),
            ("transmission.schleising.net", "Transmission"),
        ):
            with self.subTest(host=host):
                context = nginx_5xx_page_context(
                    raw_status="502",
                    raw_host=host,
                    raw_uri="/",
                    raw_variant="rebuild",
                )
                self.assertEqual(context["error_title"], f"{name} is temporarily offline.")
                self.assertIn("NAS storage pool is rebuilt", context["error_message"])

    def test_generic_502_uses_fallback_title_for_unknown_service(self) -> None:
        context = nginx_5xx_page_context(
            raw_status="502",
            raw_host="portainer.schleising.net",
            raw_uri="/",
            raw_variant="",
        )

        self.assertEqual(context["error_heading"], "Bad Gateway")
        self.assertEqual(context["error_title"], "This application could not be reached.")
        self.assertEqual(service_label("portainer.schleising.net"), "This application")

    def test_www_host_does_not_set_site_origin(self) -> None:
        context = nginx_5xx_page_context(
            raw_status="503",
            raw_host="www.schleising.net",
            raw_uri="/football/table/",
            raw_variant=None,
        )

        self.assertEqual(context["error_code"], 503)
        self.assertEqual(context["site_origin"], "")
        self.assertEqual(
            context["retry_url"],
            "https://www.schleising.net/football/table/",
        )


if __name__ == "__main__":
    unittest.main()
