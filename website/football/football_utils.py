from zoneinfo import ZoneInfo

from .football_db import get_table_db, retreive_head_to_head_matches


from .models import FootballBetData, FootballBetList, Match, MatchStatus, TableItem


def update_match_timezone(matches: list[Match]) -> list[Match]:
    local_tz = ZoneInfo("Europe/London")

    for match in matches:
        match.local_date = match.utc_date.astimezone(local_tz)

    return matches


async def create_bet_standings() -> FootballBetList:
    # Get the bet data for the current user
    bet_data = FootballBetList(bets=[])

    # Get the number of points and games remaining for Liverpool, Chelsea and Tottenham
    liverpool_points = 0
    chelsea_points = 0
    tottenham_points = 0

    liverpool_remaining = 0
    chelsea_remaining = 0
    tottenham_remaining = 0

    table = await get_table_db()

    for table_item in table:
        team_details = TableItem.model_validate(table_item)
        if team_details.team.short_name == "Liverpool":
            liverpool_points = team_details.points
            liverpool_remaining = 38 - team_details.played_games
        elif team_details.team.short_name == "Chelsea":
            chelsea_points = team_details.points
            chelsea_remaining = 38 - team_details.played_games
        elif team_details.team.short_name == "Tottenham":
            tottenham_points = team_details.points
            tottenham_remaining = 38 - team_details.played_games

    # Get the matches between Liverpool, Chelsea and Tottenham
    liverpool_chelsea = await retreive_head_to_head_matches("Liverpool", "Chelsea")
    liverpool_tottenham = await retreive_head_to_head_matches("Liverpool", "Tottenham")
    chelsea_tottenham = await retreive_head_to_head_matches("Chelsea", "Tottenham")

    # Filter out matches that have already finished and count them
    liverpool_chelsea = len(
        [
            match
            for match in liverpool_chelsea
            if match.status
            not in [MatchStatus.in_play, MatchStatus.paused, MatchStatus.finished]
        ]
    )
    liverpool_tottenham = len(
        [
            match
            for match in liverpool_tottenham
            if match.status
            not in [MatchStatus.in_play, MatchStatus.paused, MatchStatus.finished]
        ]
    )
    chelsea_tottenham = len(
        [
            match
            for match in chelsea_tottenham
            if match.status
            not in [MatchStatus.in_play, MatchStatus.paused, MatchStatus.finished]
        ]
    )

    # Calculate the best case for each team
    liverpool_best_case = (
        (liverpool_points + (liverpool_remaining * 3))
        - chelsea_points
        - (chelsea_tottenham * 1)
        + (liverpool_points + (liverpool_remaining * 3))
        - tottenham_points
        - (chelsea_tottenham * 1)
    ) * 5

    chelsea_best_case = (
        (chelsea_points + (chelsea_remaining * 3))
        - liverpool_points
        - (liverpool_tottenham * 1)
        + (chelsea_points + (chelsea_remaining * 3))
        - tottenham_points
        - (liverpool_tottenham * 1)
    ) * 5

    tottenham_best_case = (
        (tottenham_points + (tottenham_remaining * 3))
        - liverpool_points
        - (chelsea_tottenham * 1)
        + (tottenham_points + (tottenham_remaining * 3))
        - chelsea_points
        - (chelsea_tottenham * 1)
    ) * 5

    # Calculate the worst case for each team
    liverpool_worst_case = (
        -(chelsea_points - liverpool_points)
        - (tottenham_points - liverpool_points)
        - ((chelsea_remaining - chelsea_tottenham) * 3)
        - ((tottenham_remaining - chelsea_tottenham) * 3)
        - chelsea_tottenham * 3
    ) * 5

    chelsea_worst_case = (
        -(liverpool_points - chelsea_points)
        - (tottenham_points - chelsea_points)
        - ((liverpool_remaining - liverpool_tottenham) * 3)
        - ((tottenham_remaining - liverpool_tottenham) * 3)
        - liverpool_tottenham * 3
    ) * 5

    tottenham_worst_case = (
        -(liverpool_points - tottenham_points)
        - (chelsea_points - tottenham_points)
        - ((liverpool_remaining - liverpool_chelsea) * 3)
        - ((chelsea_remaining - liverpool_chelsea) * 3)
        - liverpool_chelsea * 3
    ) * 5

    # Create a bet data object for each user
    liverpool_bet_data = FootballBetData(
        team_name="liverpool",
        name="Steve",
        points=liverpool_points,
        owea="From Tim" if (liverpool_points - chelsea_points) > 0 else "To Tim",
        amounta=(liverpool_points - chelsea_points) * 5,
        oweb=(
            "From Thommo" if (liverpool_points - tottenham_points) > 0 else "To Thommo"
        ),
        amountb=(liverpool_points - tottenham_points) * 5,
        best_case=liverpool_best_case,
        worst_case=liverpool_worst_case,
        balance="Steve's Balance",
        balance_amount=(
            (liverpool_points - chelsea_points) + (liverpool_points - tottenham_points)
        )
        * 5,
    )

    chelsea_bet_data = FootballBetData(
        team_name="chelsea",
        name="Tim",
        points=chelsea_points,
        owea="From Steve" if (chelsea_points - liverpool_points) > 0 else "To Steve",
        amounta=(chelsea_points - liverpool_points) * 5,
        oweb="From Thommo" if (chelsea_points - tottenham_points) > 0 else "To Thommo",
        amountb=(chelsea_points - tottenham_points) * 5,
        best_case=chelsea_best_case,
        worst_case=chelsea_worst_case,
        balance="Tim's Balance",
        balance_amount=(
            (chelsea_points - liverpool_points) + (chelsea_points - tottenham_points)
        )
        * 5,
    )

    tottenham_bet_data = FootballBetData(
        team_name="tottenham",
        name="Thommo",
        points=tottenham_points,
        owea="From Steve" if (tottenham_points - liverpool_points) > 0 else "To Steve",
        amounta=(tottenham_points - liverpool_points) * 5,
        oweb="From Tim" if (tottenham_points - chelsea_points) > 0 else "To Tim",
        amountb=(tottenham_points - chelsea_points) * 5,
        best_case=tottenham_best_case,
        worst_case=tottenham_worst_case,
        balance="Thommo's Balance",
        balance_amount=(
            (tottenham_points - liverpool_points) + (tottenham_points - chelsea_points)
        )
        * 5,
    )

    # Add the bet data to the list
    bet_data.bets.extend([liverpool_bet_data, chelsea_bet_data, tottenham_bet_data])

    # Sort the bet data by the points field
    bet_data.bets.sort(key=lambda x: x.points, reverse=True)

    return bet_data
