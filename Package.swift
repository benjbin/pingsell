// swift-tools-version:5.9
// SDK iOS de Pingsell (notifications push, centre de notifications). Le code est dans sdk/ios.
// Xcode → File → Add Package Dependencies… → https://github.com/benjbin/pingsell
import PackageDescription

let package = Package(
    name: "Pingsell",
    platforms: [.iOS(.v14)],
    products: [
        .library(name: "Pingsell", targets: ["Pingsell"]),
    ],
    targets: [
        .target(name: "Pingsell", path: "sdk/ios/Sources/Pingsell"),
        .testTarget(name: "PingsellTests", dependencies: ["Pingsell"], path: "sdk/ios/Tests/PingsellTests"),
    ]
)
