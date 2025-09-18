package main

import "time"

type UserLocation struct {
	IP        string
	City      string
	Country   string
	Latitude  float64
	Longitude float64
	Accuracy  uint16
	Timestamp time.Time
}
