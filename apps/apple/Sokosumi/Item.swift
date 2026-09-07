//
//  Item.swift
//  Sokosumi
//
//  Created by Andreas Osberghaus on 07.09.26.
//

import Foundation
import SwiftData

@Model
final class Item {
    var timestamp: Date
    
    init(timestamp: Date) {
        self.timestamp = timestamp
    }
}
