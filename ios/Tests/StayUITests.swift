import XCTest

final class StayUITests: XCTestCase {
    @MainActor
    func testFindHotelAndOpenNightlyQuote() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment["STAY_UI_TEST_FIXTURE"] = UUID().uuidString
        app.launch()
        let page = app.webViews.firstMatch
        let search = page.buttons["查询酒店和房态"]
        XCTAssertTrue(search.waitForExistence(timeout: 30))
        XCTAssertTrue(page.buttons["只查一晚"].exists)
        page.buttons["只查一晚"].tap()
        search.tap()
        let hotel = page.links.matching(identifier: "查看房型和逐日房态").firstMatch
        XCTAssertTrue(hotel.waitForExistence(timeout: 10))
        reveal(hotel, in: page)
        hotel.tap()
        XCTAssertTrue(page.staticTexts["房型与逐日房态"].waitForExistence(timeout: 10))
        let quote = page.links.matching(identifier: "核对报价并预订").firstMatch
        reveal(quote, in: page)
        quote.tap()
        XCTAssertTrue(page.staticTexts["逐晚报价"].waitForExistence(timeout: 10))
        XCTAssertTrue(page.buttons["确认报价并提交预订"].exists)
        let image = XCTAttachment(screenshot: app.screenshot())
        image.name = "iPhone 预订报价"
        image.lifetime = .keepAlways
        add(image)
        let contact = page.textFields["联系人"]
        reveal(contact, in: page)
        contact.tap()
        contact.typeText("iPhone Demo")
        let submit = page.buttons["确认报价并提交预订"]
        reveal(submit, in: page)
        submit.tap()
        XCTAssertTrue(page.staticTexts["成交逐晚明细"].waitForExistence(timeout: 10))
        XCTAssertTrue(page.staticTexts["ST-000001"].exists)
    }

    @MainActor
    private func reveal(_ element: XCUIElement, in page: XCUIElement) {
        for _ in 0..<4 where !element.isHittable {
            page.swipeUp()
        }
        XCTAssertTrue(element.isHittable)
    }
}
