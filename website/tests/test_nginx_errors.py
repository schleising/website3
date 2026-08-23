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

    def test_502_explains_bad_gateway_and_names_service(self) -> None:
        context = nginx_5xx_page_context(
            raw_status="502",
            raw_host="overseerr.schleising.net",
            raw_uri="/",
        )

        self.assertEqual(context["error_code"], 502)
        self.assertEqual(context["error_heading"], "Bad Gateway")
        self.assertEqual(context["error_title"], "Overseerr could not be reached.")
        self.assertIn("stopped, crashed, or refusing connections", context["error_message"])
        self.assertEqual(context["retry_url"], "https://overseerr.schleising.net/")
        self.assertEqual(context["site_origin"], SITE_ORIGIN)
        self.assertEqual(context["login_next"], "https://overseerr.schleising.net/")

    def test_503_explains_service_unavailable(self) -> None:
        context = nginx_5xx_page_context(
            raw_status="503",
            raw_host="sonarr.schleising.net",
            raw_uri="/",
        )

        self.assertEqual(context["error_heading"], "Service Unavailable")
        self.assertEqual(context["error_title"], "Sonarr is temporarily unavailable.")
        self.assertIn("overloaded, restarting", context["error_message"])

    def test_504_explains_gateway_timeout(self) -> None:
        context = nginx_5xx_page_context(
            raw_status="504",
            raw_host="radarr.schleising.net",
            raw_uri="/",
        )

        self.assertEqual(context["error_heading"], "Gateway Timeout")
        self.assertEqual(context["error_title"], "Radarr took too long to respond.")
        self.assertIn("no response arrived in time", context["error_message"])

    def test_500_explains_internal_server_error(self) -> None:
        context = nginx_5xx_page_context(
            raw_status="500",
            raw_host="www.schleising.net",
            raw_uri="/football/table/",
        )

        self.assertEqual(context["error_heading"], "Internal Server Error")
        self.assertEqual(
            context["error_title"],
            "The application hit an unexpected server error.",
        )
        self.assertIn("fault on the server", context["error_message"])
        self.assertEqual(context["site_origin"], "")

    def test_other_5xx_keeps_status_and_explains(self) -> None:
        context = nginx_5xx_page_context(
            raw_status="505",
            raw_host="portainer.schleising.net",
            raw_uri="/",
        )

        self.assertEqual(context["error_code"], 505)
        self.assertEqual(context["error_heading"], "Server Error")
        self.assertIn("HTTP 505", context["error_message"])
        self.assertEqual(service_label("portainer.schleising.net"), "This application")

    def test_named_services_include_nas_apps(self) -> None:
        for host, name in (
            ("tautulli.schleising.net", "Tautulli"),
            ("prowlarr.schleising.net", "Prowlarr"),
            ("plex.schleising.net", "Plex"),
            ("transmission.schleising.net", "Transmission"),
        ):
            with self.subTest(host=host):
                context = nginx_5xx_page_context(
                    raw_status="502",
                    raw_host=host,
                    raw_uri="/",
                )
                self.assertEqual(context["error_title"], f"{name} could not be reached.")


if __name__ == "__main__":
    unittest.main()
