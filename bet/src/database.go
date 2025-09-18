package main

import (
	"context"
	"fmt"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"github.com/oschwald/geoip2-golang"
)

type Database struct {
	client *mongo.Client
}

const MONGO_CONNECTION_STRING = "mongodb://host.docker.internal:27017"
const WEB_DATABASE = "web_database"
const PL_MATCHES_COLLECTION = "pl_matches_2025_2026"
const PL_TABLE_COLLECTION = "live_pl_table"
const USER_LOCATION_COLLECTION = "user_locations"

func NewDatabase() (*Database, error) {
	// Create an options struct with the connection string and a 3 second timeout
	opts := options.Client().
		ApplyURI(MONGO_CONNECTION_STRING).
		SetConnectTimeout(3 * time.Second).
		SetTimeout(3 * time.Second).
		SetServerSelectionTimeout(3 * time.Second)

	// Connect to MongoDB
	client, err := mongo.Connect(opts)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to MongoDB: %w", err)
	}

	// Create a 3 second timeout context
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	// Ping the database to ensure the connection is established
	if err := client.Ping(ctx, nil); err != nil {
		return nil, fmt.Errorf("failed to ping MongoDB: %w", err)
	}

	return &Database{client: client}, nil
}

func (db *Database) Close() error {
	// Create a 3 second timeout context
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	// Disconnect from MongoDB
	if err := db.client.Disconnect(ctx); err != nil {
		return fmt.Errorf("failed to disconnect from MongoDB: %w", err)
	}

	return nil
}

func (db *Database) GetTableDb() ([]LiveTableItem, error) {
	var tableList []LiveTableItem

	// Create a 3 second timeout context
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	// Query the database
	cursor, err := db.client.Database(WEB_DATABASE).Collection(PL_TABLE_COLLECTION).Find(ctx, bson.M{})
	if err != nil {
		return nil, fmt.Errorf("failed to find documents: %w", err)
	}
	defer cursor.Close(ctx)

	// Iterate through the cursor
	for cursor.Next(ctx) {
		var item LiveTableItem
		if err := cursor.Decode(&item); err != nil {
			return nil, fmt.Errorf("failed to decode document: %w", err)
		}
		tableList = append(tableList, item)
	}

	if err := cursor.Err(); err != nil {
		return nil, fmt.Errorf("cursor error: %w", err)
	}

	return tableList, nil
}

func (db *Database) GetTeamLeagueDataDb(team string) (*LiveTableItem, error) {
	var teamData *LiveTableItem

	// Create a 3 second timeout context
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	// Query the database
	err := db.client.Database(WEB_DATABASE).Collection(PL_TABLE_COLLECTION).FindOne(ctx, bson.M{
		"team.short_name": team,
	}).Decode(&teamData)
	if err != nil {
		return nil, fmt.Errorf("failed to find document: %w", err)
	}

	return teamData, nil
}

func (db *Database) GetHeadToHeadMatchesDb(team_a_short_name, team_b_short_name string) ([]Match, error) {
	var matches []Match

	// Create a 3 second timeout context
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	// Query the database
	cursor, err := db.client.Database(WEB_DATABASE).Collection(PL_MATCHES_COLLECTION).Find(ctx, bson.M{
		"$or": []bson.M{
			{
				"home_team.short_name": team_a_short_name,
				"away_team.short_name": team_b_short_name,
			},
			{
				"home_team.short_name": team_b_short_name,
				"away_team.short_name": team_a_short_name,
			},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to find documents: %w", err)
	}
	defer cursor.Close(ctx)

	// Iterate through the cursor
	for cursor.Next(ctx) {
		var item Match
		if err := cursor.Decode(&item); err != nil {
			return nil, fmt.Errorf("failed to decode document: %w", err)
		}
		matches = append(matches, item)
	}

	if err := cursor.Err(); err != nil {
		return nil, fmt.Errorf("cursor error: %w", err)
	}

	return matches, nil
}

func (db *Database) GetLatestTeamMatchDb(team string) (*Match, error) {
	var match *Match

	// Get the match for this team with the most recent start time before now
	// Create a 3 second timeout context
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	// Query the database
	err := db.client.Database(WEB_DATABASE).Collection(PL_MATCHES_COLLECTION).FindOne(ctx, bson.M{
		"$or": []bson.M{
			{"home_team.short_name": team},
			{"away_team.short_name": team},
		},
		"utc_date": bson.M{"$lte": time.Now().UTC()},
	}, options.FindOne().SetSort(bson.M{"utc_date": -1})).Decode(&match)
	if err != nil {
		return nil, fmt.Errorf("failed to find documents: %w", err)
	}

	return match, nil
}

func (db *Database) UpdateUserLocation(ip string, city geoip2.City) error {
	// Create a 3 second timeout context
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	// Create a user location object
	userLocation := UserLocation{
		IP:        ip,
		City:      city.City.Names["en"],
		Country:   city.Country.Names["en"],
		Latitude:  city.Location.Latitude,
		Longitude: city.Location.Longitude,
		Accuracy:  city.Location.AccuracyRadius,
		Timestamp: time.Now().UTC(),
	}

	// Insert the user location into the database
	_, err := db.client.Database(WEB_DATABASE).Collection(USER_LOCATION_COLLECTION).InsertOne(ctx, userLocation)
	if err != nil {
		return fmt.Errorf("failed to insert document: %w", err)
	}

	return nil
}
