import unittest

from cbpi4_brewdio.converter import convert_recipe, duration_minutes, temperature_celsius


class ConversionTests(unittest.TestCase):
    def test_converts_fahrenheit_to_celsius(self):
        self.assertAlmostEqual(temperature_celsius({"value": 152, "unit": "F"}), 66.666, places=2)

    def test_converts_hours_to_minutes(self):
        self.assertEqual(duration_minutes({"value": 1.5, "unit": "h"}), 90)

    def test_builds_mash_boil_and_hop_steps(self):
        detail = {
            "id": "01TEST",
            "recipe": {
                "name": "Testpils",
                "author": "Brygger",
                "mash": {
                    "mash_steps": [
                        {
                            "name": "Sukkerkonvertering",
                            "step_temperature": {"value": 68, "unit": "C"},
                            "step_time": {"value": 60, "unit": "min"},
                        }
                    ]
                },
                "boil": {"boil_time": {"value": 60, "unit": "min"}},
                "ingredients": {
                    "hop_additions": [
                        {
                            "name": "Magnum",
                            "amount": {"value": 8, "unit": "g"},
                            "timing": {
                                "use": "add_to_boil",
                                "time": {"value": 60, "unit": "min"},
                            },
                        }
                    ]
                },
            },
        }
        result = convert_recipe(detail, "kettle", "sensor")
        self.assertEqual(result["basic"]["name"], "Brewdio – Testpils")
        self.assertEqual(result["basic"]["brewdio_recipe_id"], "01TEST")
        self.assertEqual(result["steps"][0]["type"], "BrewdioStartBatchStep")
        self.assertEqual(result["steps"][0]["props"]["RecipeId"], "01TEST")
        self.assertEqual(result["steps"][1]["type"], "MashStep")
        self.assertEqual(result["steps"][1]["props"]["Temp"], "68")
        self.assertEqual(result["steps"][2]["type"], "BoilStep")
        self.assertEqual(result["steps"][2]["props"]["Hop_1"], "60")
        self.assertEqual(result["steps"][2]["props"]["Hop_1_text"], "Magnum – 8 g")

    def test_accepts_camel_case_beerjson_fields(self):
        detail = {
            "id": "camel",
            "recipe": {
                "name": "Camel",
                "mash": {
                    "mashSteps": [
                        {
                            "stepTemperature": {"value": 149, "unit": "F"},
                            "stepTime": {"value": 1, "unit": "h"},
                        }
                    ]
                },
                "boil": {"boilTime": {"value": 3600, "unit": "s"}},
            },
        }
        result = convert_recipe(detail, "k", "s")
        self.assertEqual(result["steps"][1]["props"]["Timer"], "60")
        self.assertEqual(result["steps"][1]["props"]["Temp"], "65")
        self.assertEqual(result["steps"][2]["props"]["Timer"], "60")


if __name__ == "__main__":
    unittest.main()
