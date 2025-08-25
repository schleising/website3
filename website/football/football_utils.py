from typing import Self
from zoneinfo import ZoneInfo
from dataclasses import dataclass

from .football_db import (
    get_table_db,
    retreive_head_to_head_matches,
    retreive_latest_team_match,
)


from .models import (
    FootballBetData,
    FootballBetList,
    LiveTableItem,
    Match,
)


@dataclass
class TeamPointsData:
    team_name: str
    current_points: int = 0
    matches_played: int = 0
    remaining_matches: int = 0
    remaining_other_h2h_matches: int = 0
    match_in_play: bool = False

    def _team_best_case(self, other_team: Self) -> int:
        # Calculate the max points for this team
        max_own_points = self.current_points + (self.remaining_matches * 3)

        # Calculate the min points for the other team
        min_other_points = (
            other_team.current_points
            + (other_team.remaining_matches * 0)
            + (self.remaining_other_h2h_matches * 1)
        )

        # Calculate the point difference
        return max_own_points - min_other_points

    def best_case(self, team_1: Self, team_2: Self) -> int:
        return (self._team_best_case(team_1) + self._team_best_case(team_2)) * 5

    def _team_worst_case(self, other_team: Self) -> int:
        # Calculate the min points for this team
        min_own_points = self.current_points + (self.remaining_matches * 0)

        # Calculate the max points for the other team
        max_other_points = other_team.current_points + (
            (other_team.remaining_matches - self.remaining_other_h2h_matches) * 3
        )

        # Calculate the point difference
        return min_own_points - max_other_points

    def worst_case(self, team_1: Self, team_2: Self) -> int:
        return (
            self._team_worst_case(team_1)
            + self._team_worst_case(team_2)
            - (self.remaining_other_h2h_matches * 3)
        ) * 5


def update_match_timezone(matches: list[Match]) -> list[Match]:
    local_tz = ZoneInfo("Europe/London")

    for match in matches:
        # Convert the match time to local time
        match.local_date = match.utc_date.astimezone(local_tz)

    return matches


async def adjust_in_play_matches(
    team_name: str, team_point_data: TeamPointsData
) -> TeamPointsData:
    latest_match = await retreive_latest_team_match(team_name)

    if latest_match is not None and latest_match.status.is_live:
        # Decrease the matches played
        team_point_data.matches_played -= 1

        # Add one to the matches remaining
        team_point_data.remaining_matches += 1

        # Subtract the points for a live match
        team_point_data.current_points -= latest_match.team_points(team_name) or 0

        # Set the live flag
        team_point_data.match_in_play = True

    return team_point_data


async def create_bet_standings() -> FootballBetList:
    # Get the bet data for the current user
    bet_data = FootballBetList(bets=[])

    # Initialise the points for Liverpool, Chelsea and Tottenham
    liverpool = TeamPointsData("Liverpool")
    chelsea = TeamPointsData("Chelsea")
    tottenham = TeamPointsData("Tottenham")

    # Get the current table data
    table_data: list[LiveTableItem] = await get_table_db()

    # Get the current points and remaining matches for each team
    for item in table_data:
        if item.team.short_name == "Liverpool":
            liverpool.matches_played = item.played_games
            liverpool.current_points = item.points
            liverpool.remaining_matches = 38 - item.played_games
        elif item.team.short_name == "Chelsea":
            chelsea.matches_played = item.played_games
            chelsea.current_points = item.points
            chelsea.remaining_matches = 38 - item.played_games
        elif item.team.short_name == "Tottenham":
            tottenham.matches_played = item.played_games
            tottenham.current_points = item.points
            tottenham.remaining_matches = 38 - item.played_games

    # Get the head to head matches between the other teams
    liverpool_other_h2h = await retreive_head_to_head_matches("Liverpool", "Chelsea")
    chelsea_other_h2h = await retreive_head_to_head_matches("Chelsea", "Tottenham")
    tottenham_other_h2h = await retreive_head_to_head_matches("Tottenham", "Liverpool")

    # Filter out head to head matches that have already finished
    liverpool.remaining_other_h2h_matches = len(
        [match for match in liverpool_other_h2h if not match.status.has_finished]
    )
    chelsea.remaining_other_h2h_matches = len(
        [match for match in chelsea_other_h2h if not match.status.has_finished]
    )
    tottenham.remaining_other_h2h_matches = len(
        [match for match in tottenham_other_h2h if not match.status.has_finished]
    )

    liverpool = await adjust_in_play_matches("Liverpool", liverpool)
    chelsea = await adjust_in_play_matches("Chelsea", chelsea)
    tottenham = await adjust_in_play_matches("Tottenham", tottenham)

    # Create the BetData structs for the three teams
    liverpool_bet_data = FootballBetData(
        team_name=liverpool.team_name.lower(),
        name="Steve",
        played=liverpool.matches_played,
        points=liverpool.current_points,
        owea=(
            "To Tim"
            if liverpool.current_points < chelsea.current_points
            else "From Tim"
        ),
        amounta=(liverpool.current_points - chelsea.current_points) * 5,
        oweb=(
            "To Thommo"
            if liverpool.current_points < tottenham.current_points
            else "From Thommo"
        ),
        amountb=(liverpool.current_points - tottenham.current_points) * 5,
        best_case=liverpool.best_case(chelsea, tottenham),
        worst_case=liverpool.worst_case(chelsea, tottenham),
        balance="Steve's Balance",
        balance_amount=(
            liverpool.current_points
            - chelsea.current_points
            + liverpool.current_points
            - tottenham.current_points
        )
        * 5,
        live=liverpool.match_in_play,
    )

    chelsea_bet_data = FootballBetData(
        team_name=chelsea.team_name.lower(),
        name="Tim",
        played=chelsea.matches_played,
        points=chelsea.current_points,
        owea=(
            "To Steve"
            if chelsea.current_points < liverpool.current_points
            else "From Steve"
        ),
        amounta=(chelsea.current_points - liverpool.current_points) * 5,
        oweb=(
            "To Thommo"
            if chelsea.current_points < tottenham.current_points
            else "From Thommo"
        ),
        amountb=(chelsea.current_points - tottenham.current_points) * 5,
        best_case=chelsea.best_case(liverpool, tottenham),
        worst_case=chelsea.worst_case(liverpool, tottenham),
        balance="Tim's Balance",
        balance_amount=(
            chelsea.current_points
            - liverpool.current_points
            + chelsea.current_points
            - tottenham.current_points
        )
        * 5,
        live=chelsea.match_in_play,
    )

    tottenham_bet_data = FootballBetData(
        team_name=tottenham.team_name.lower(),
        name="Thommo",
        played=tottenham.matches_played,
        points=tottenham.current_points,
        owea=(
            "To Steve"
            if tottenham.current_points < liverpool.current_points
            else "From Steve"
        ),
        amounta=(tottenham.current_points - liverpool.current_points) * 5,
        oweb=(
            "To Tim"
            if tottenham.current_points < chelsea.current_points
            else "From Tim"
        ),
        amountb=(tottenham.current_points - chelsea.current_points) * 5,
        best_case=tottenham.best_case(liverpool, chelsea),
        worst_case=tottenham.worst_case(liverpool, chelsea),
        balance="Thommo's Balance",
        balance_amount=(
            tottenham.current_points
            - liverpool.current_points
            + tottenham.current_points
            - chelsea.current_points
        )
        * 5,
        live=tottenham.match_in_play,
    )

    # Add the bet data to the list
    bet_data.bets.extend([liverpool_bet_data, chelsea_bet_data, tottenham_bet_data])

    # Sort the bet data by points
    bet_data.bets.sort(key=lambda x: x.points, reverse=True)

    return bet_data
