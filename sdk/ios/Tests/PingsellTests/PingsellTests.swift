import XCTest
@testable import Pingsell

final class PingsellTests: XCTestCase {
    func testPingsellNotificationIsRecognised() {
        XCTAssertTrue(Pingsell.isPingsellNotification(["pingsell_message_id": "m1", "aps": [:]]))
        XCTAssertFalse(Pingsell.isPingsellNotification(["screen": "reservation", "reserv_id": "12"]))
    }

    func testNotificationData() {
        let n = Pingsell.makeNotification(title: "T", body: "B", userInfo: [
            "pingsell_message_id": "m1", "pingsell_inbox_id": "i1", "url": "https://nightsquare.org/events", "badge": NSNumber(value: 3), "aps": ["alert": "x"],
        ])
        XCTAssertEqual(n.messageId, "m1")
        XCTAssertEqual(n.inboxId, "i1")
        XCTAssertEqual(n.url?.absoluteString, "https://nightsquare.org/events")
        XCTAssertEqual(n.data["badge"], "3")
        XCTAssertNil(n.data["aps"])
    }

    func testAPNsTokenIsHex() {
        // Sans app hôte, UNUserNotificationCenter n'existe pas : configuration posée directement.
        Pingsell.state.sync { Pingsell.state.config = .init(appKey: "msvapp_test", apiURL: URL(string: "http://127.0.0.1:9")!, provider: .apns) }
        Pingsell.setAPNsToken(Data([0x0a, 0xff, 0x10]))
        XCTAssertEqual(Pingsell.deviceToken, "0aff10")
    }
}
