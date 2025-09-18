package main

import "time"

type UserLocation struct {
	IP        string
	City      string
	Country   string
	Timestamp time.Time
}
